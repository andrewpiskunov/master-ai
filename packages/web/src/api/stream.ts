import type { CompleteInput } from "@master-ai/shared";
import { ApiError } from "./client.js";

// Стриминг ответа LLM. signal позволяет остановить генерацию кнопкой «Стоп»:
// при прерывании возвращаем уже полученный текст, а не бросаем ошибку.
export async function streamComplete(
  input: CompleteInput,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let full = "";
  try {
    const res = await fetch("/api/llm/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new ApiError(res.status, `Ошибка LLM (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
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
  } catch (e) {
    if ((e as Error).name === "AbortError") return full; // остановлено пользователем
    throw e;
  }
  return full;
}
