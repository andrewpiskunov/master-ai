import type { LLMProvider } from "./provider.js";
import { CliProvider } from "./cli.js";

export function loadProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const kind = env.MASTER_AI_LLM ?? "cli";
  if (kind === "cli") {
    const command = env.MASTER_AI_LLM_CMD ?? "claude";
    const args = (env.MASTER_AI_LLM_ARGS ?? "-p").split(" ").filter(Boolean);
    return new CliProvider({ command, args });
  }
  throw new Error(`Неизвестный LLM-провайдер: ${kind}`);
}
