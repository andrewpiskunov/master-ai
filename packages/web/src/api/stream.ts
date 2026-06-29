import type { CompleteInput } from "@master-ai/shared";
import { ApiError } from "./client.js";

export async function streamComplete(
  input: CompleteInput,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch("/api/llm/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Ошибка LLM (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      full += text;
      onChunk(text);
    }
  }
  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onChunk(tail);
  }
  return full;
}
