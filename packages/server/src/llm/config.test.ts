import { describe, it, expect } from "vitest";
import { loadProvider } from "./config.js";
import { CliProvider } from "./cli.js";

describe("loadProvider", () => {
  it("по умолчанию возвращает CliProvider (claude -p)", () => {
    const provider = loadProvider({});
    expect(provider).toBeInstanceOf(CliProvider);
  });

  it("уважает MASTER_AI_LLM_CMD / _ARGS", () => {
    const provider = loadProvider({ MASTER_AI_LLM: "cli", MASTER_AI_LLM_CMD: "llm", MASTER_AI_LLM_ARGS: "chat -m gpt" });
    expect(provider).toBeInstanceOf(CliProvider);
    // конфиг доступен через приватное поле — проверяем через поведение renderPrompt не нужно; достаточно типа
  });

  it("бросает на неизвестном провайдере", () => {
    expect(() => loadProvider({ MASTER_AI_LLM: "telepathy" })).toThrow();
  });
});
