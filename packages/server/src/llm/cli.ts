import { spawn } from "node:child_process";
import type { CompleteInput } from "@master-ai/shared";
import { type LLMProvider, LlmError } from "./provider.js";

export interface CliProviderConfig {
  command: string;
  args: string[];
}

export function renderPrompt(input: CompleteInput): string {
  const parts: string[] = [];
  if (input.system) parts.push(input.system);
  for (const m of input.messages) parts.push(`${m.role}: ${m.content}`);
  return parts.join("\n\n");
}

export class CliProvider implements LLMProvider {
  constructor(private config: CliProviderConfig) {}

  async *complete(input: CompleteInput): AsyncIterable<string> {
    const child = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // ошибка запуска процесса (например, команда не найдена)
    const spawnError = new Promise<never>((_, reject) => {
      child.on("error", (err) => reject(new LlmError(`Не удалось запустить CLI: ${err.message}`)));
    });

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.stdin.write(renderPrompt(input));
    child.stdin.end();

    // стримим stdout; гонимся со spawnError, чтобы упасть, если процесс не стартовал
    const stdoutIterator = child.stdout[Symbol.asyncIterator]();
    while (true) {
      const next = await Promise.race([stdoutIterator.next(), spawnError]);
      if (next.done) break;
      yield (next.value as Buffer).toString();
    }

    const code: number | null = await Promise.race([
      new Promise<number | null>((resolve) => child.on("close", resolve)),
      spawnError,
    ]);
    if (code !== 0) {
      throw new LlmError(`CLI завершился с кодом ${code}: ${stderr}`);
    }
  }
}
