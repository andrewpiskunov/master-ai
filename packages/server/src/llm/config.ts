import type { LLMProvider } from "./provider.js";
import type { CliProviderInfo } from "@master-ai/shared";
import { CliProvider } from "./cli.js";

export function getCliProviderInfo(env: NodeJS.ProcessEnv = process.env): CliProviderInfo {
  // Для интерфейса достаточно имени исполняемого файла; пути и аргументы не отдаём.
  const command = (env.MASTER_AI_LLM_CMD ?? "claude").split(/[\\/]/).pop() ?? "claude";
  const executable = command.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  const name = executable === "codex" ? "Codex" : executable === "claude" ? "Claude Code" : command;
  return { name, command };
}

export function loadProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const kind = env.MASTER_AI_LLM ?? "cli";
  if (kind === "cli") {
    const command = env.MASTER_AI_LLM_CMD ?? "claude";
    const args = (env.MASTER_AI_LLM_ARGS ?? "-p").split(" ").filter(Boolean);
    return new CliProvider({ command, args });
  }
  throw new Error(`Неизвестный LLM-провайдер: ${kind}`);
}
