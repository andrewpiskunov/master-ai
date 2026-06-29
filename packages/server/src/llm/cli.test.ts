import { describe, it, expect } from "vitest";
import { CliProvider, renderPrompt } from "./cli.js";
import { LlmError } from "./provider.js";

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const c of iter) out += c;
  return out;
}

const input = { messages: [{ role: "user" as const, content: "привет" }] };

describe("renderPrompt", () => {
  it("склеивает system и сообщения", () => {
    const text = renderPrompt({ system: "ты ГМ", messages: [{ role: "user", content: "привет" }] });
    expect(text).toContain("ты ГМ");
    expect(text).toContain("user: привет");
  });
});

describe("CliProvider", () => {
  it("стримит stdout подставной команды (эхо stdin)", async () => {
    // node-команда: читает stdin, печатает 'ECHO:' + ввод
    const provider = new CliProvider({
      command: "node",
      args: ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write('ECHO:'+d))"],
    });
    const out = await collect(provider.complete(input));
    expect(out).toContain("ECHO:");
    expect(out).toContain("user: привет");
  });

  it("бросает LlmError при ненулевом коде выхода", async () => {
    const provider = new CliProvider({
      command: "node",
      args: ["-e", "process.stderr.write('boom');process.exit(3)"],
    });
    await expect(collect(provider.complete(input))).rejects.toBeInstanceOf(LlmError);
  });

  it("бросает LlmError если команда не найдена", async () => {
    const provider = new CliProvider({ command: "definitely-not-a-real-cmd-xyz", args: [] });
    await expect(collect(provider.complete(input))).rejects.toBeInstanceOf(LlmError);
  });
});
