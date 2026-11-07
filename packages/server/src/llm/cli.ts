import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { CompleteInput } from "@master-ai/shared";
import { type CompleteOptions, type LLMProvider, LlmError, estimateTokens } from "./provider.js";

export interface CliProviderConfig {
  command: string;
  args: string[];
  // Рабочая директория для CLI. По умолчанию — нейтральный temp, чтобы инструменты
  // вроде `claude` не подхватывали проектный CLAUDE.md и не подмешивали его в ответ.
  cwd?: string;
}

export function renderPrompt(input: CompleteInput): string {
  const parts: string[] = [];
  if (input.system) parts.push(input.system);
  for (const m of input.messages) parts.push(`${m.role}: ${m.content}`);
  return parts.join("\n\n");
}

export class CliProvider implements LLMProvider {
  constructor(private config: CliProviderConfig) {}

  async *complete(input: CompleteInput, opts?: CompleteOptions): AsyncIterable<string> {
    const startedAt = Date.now();
    const child = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.cwd ?? tmpdir(),
    });

    // Остановка по сигналу: убиваем процесс сразу — stdout закроется, цикл ниже завершится.
    const onAbort = () => { if (!child.killed) child.kill(); };
    opts?.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts?.signal?.aborted) onAbort();

    // StringDecoder будет хранить незавершённые многобайтовые последовательности между чанками
    child.stdout.setEncoding("utf8");

    // ошибка запуска процесса (например, команда не найдена)
    const spawnError = new Promise<never>((_, reject) => {
      child.on("error", (err) => reject(new LlmError(`Не удалось запустить CLI: ${err.message}`)));
    });

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    // при EPIPE/ERR_STREAM_DESTROYED на пути ошибки spawn не даём упасть серверу
    child.stdin.on("error", () => {});
    child.stdin.write(renderPrompt(input));
    child.stdin.end();

    // стримим stdout; гонимся со spawnError, чтобы упасть, если процесс не стартовал;
    // finally гарантирует завершение дочернего процесса при раннем return генератора
    let outChars = 0;
    try {
      const stdoutIterator = child.stdout[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([stdoutIterator.next(), spawnError]);
        if (next.done) break;
        outChars += (next.value as string).length;
        yield next.value as string;
      }

      const code: number | null = await Promise.race([
        new Promise<number | null>((resolve) => child.on("close", resolve)),
        spawnError,
      ]);
      // Убитый по сигналу процесс завершается ненулевым кодом — это не ошибка.
      if (code !== 0 && !opts?.signal?.aborted) {
        throw new LlmError(`CLI завершился с кодом ${code}: ${stderr}`);
      }
      // CLI не отдаёт usage — оцениваем по длине промпта и ответа (при остановке — частичного).
      opts?.onUsage?.({
        promptTokens: estimateTokens(renderPrompt(input)),
        completionTokens: estimateTokens(outChars),
        estimated: true,
        provider: "cli",
        model: this.config.command,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      opts?.signal?.removeEventListener("abort", onAbort);
      if (!child.killed) child.kill();
    }
  }
}
