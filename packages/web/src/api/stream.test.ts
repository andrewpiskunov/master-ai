import { describe, it, expect, vi, afterEach } from "vitest";
import { streamComplete } from "./stream.js";
import { ApiError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status });
}

const input = { messages: [{ role: "user" as const, content: "привет" }] };

describe("streamComplete", () => {
  it("зовёт onChunk и возвращает полный текст", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["Привет", ", ", "мир"])));
    const chunks: string[] = [];
    const full = await streamComplete(input, (c) => chunks.push(c));
    expect(full).toBe("Привет, мир");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("бросает ApiError при не-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await expect(streamComplete(input, () => {})).rejects.toBeInstanceOf(ApiError);
  });
});
