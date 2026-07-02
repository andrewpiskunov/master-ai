import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "./openai.js";
import { LlmError } from "./provider.js";

// SSE-поток в формате chat.completions со stream: true.
function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l + "\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of it) out += chunk;
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIProvider", () => {
  it("стримит дельты из SSE и шлёт system первым сообщением", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([delta("Привет"), delta(", мастер!"), "data: [DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const p = new OpenAIProvider({ apiKey: "sk-test", model: "gpt-4o-mini" });

    const out = await collect(p.complete({ system: "Ты — ассистент.", messages: [{ role: "user", content: "привет" }] }));

    expect(out).toBe("Привет, мастер!");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const payload = JSON.parse(init.body);
    expect(payload.model).toBe("gpt-4o-mini");
    expect(payload.stream).toBe(true);
    expect(payload.messages[0]).toEqual({ role: "system", content: "Ты — ассистент." });
    expect(init.headers.authorization).toBe("Bearer sk-test");
  });

  it("уважает baseUrl совместимых API (и срезает завершающий слэш)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(["data: [DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const p = new OpenAIProvider({ apiKey: "k", baseUrl: "http://localhost:1234/v1/" });
    await collect(p.complete({ messages: [{ role: "user", content: "x" }] }));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/chat/completions");
  });

  it("ошибка API → LlmError с кодом и телом", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{\"error\":{\"message\":\"Invalid API key\"}}", { status: 401 })));
    const p = new OpenAIProvider({ apiKey: "bad" });
    await expect(collect(p.complete({ messages: [{ role: "user", content: "x" }] }))).rejects.toThrow(LlmError);
  });
});
