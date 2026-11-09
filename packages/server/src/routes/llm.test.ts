import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { FakeProvider } from "../llm/fake.js";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/llm/config", () => {
  it.each([
    { command: undefined, name: "Claude Code", executable: "claude" },
    { command: "codex", name: "Codex", executable: "codex" },
    { command: "/usr/local/bin/codex", name: "Codex", executable: "codex" },
    { command: "C:\\Tools\\codex.cmd", name: "Codex", executable: "codex.cmd" },
    { command: "llm", name: "llm", executable: "llm" },
  ])("показывает $name для настроенной команды $command без аргументов и секретов", async ({ command, name, executable }) => {
    vi.stubEnv("MASTER_AI_LLM_CMD", command);
    vi.stubEnv("MASTER_AI_LLM_ARGS", "--api-key=private-test-value");
    const { db, sqlite } = createDb(":memory:");
    const app = buildApp({ db, llm: new FakeProvider([]) });
    try {
      const response = await app.inject({ method: "GET", url: "/api/llm/config" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ cli: { name, command: executable } });
    } finally {
      await app.close();
      sqlite.close();
    }
  });

  it("возвращает конфигурацию запущенного приложения, а не изменившееся окружение", async () => {
    vi.stubEnv("MASTER_AI_LLM_CMD", "codex");
    const { db, sqlite } = createDb(":memory:");
    const app = buildApp({ db, llm: new FakeProvider([]) });
    vi.stubEnv("MASTER_AI_LLM_CMD", "claude");
    try {
      const response = await app.inject({ method: "GET", url: "/api/llm/config" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ cli: { name: "Codex", command: "codex" } });
    } finally {
      await app.close();
      sqlite.close();
    }
  });
});
