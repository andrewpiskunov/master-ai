import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { CompleteInput } from "@master-ai/shared";
import { type CompleteOptions, type LLMProvider, LlmError, estimateTokens } from "./provider.js";
import { prepareCliImages, renderPrompt } from "./cli-images.js";
export { renderPrompt } from "./cli-images.js";

export interface CliProviderConfig {
  command: string;
  args: string[];
  // Рабочая директория для CLI. По умолчанию — нейтральный temp, чтобы инструменты
  // вроде `claude` не подхватывали проектный CLAUDE.md и не подмешивали его в ответ.
  cwd?: string;
}

export class CliProvider implements LLMProvider {
  constructor(private config: CliProviderConfig) {}

  async *complete(input: CompleteInput, opts?: CompleteOptions): AsyncIterable<string> {
    const startedAt = Date.now();
    const prepared = await prepareCliImages(input, this.config.command, this.config.args);
    try {
      if (opts?.signal?.aborted) return;
      yield* this.run(input, prepared.args, prepared.prompt, startedAt, opts);
    } finally {
      await prepared.cleanup();
    }
  }

  private async *run(input: CompleteInput, args: string[], prompt: string, startedAt: number, opts?: CompleteOptions): AsyncIterable<string> {
    const child = spawn(this.config.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.cwd ?? tmpdir(),
    });
    // Register before reading stdout: a short-lived command may close early.
    const closed = new Promise<number | null>((resolve) => child.once("close", resolve));

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
      stderr = (stderr + d.toString()).slice(-64_000);
    });

    // при EPIPE/ERR_STREAM_DESTROYED на пути ошибки spawn не даём упасть серверу
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
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
        closed,
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
      await closed;
    }
  }
}
