import type { CompleteInput } from "@master-ai/shared";
import { type LLMProvider, LlmError } from "./provider.js";

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  // Для OpenAI-совместимых API (OpenRouter, локальные модели): базовый URL вида https://host/v1.
  baseUrl?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE = "https://api.openai.com/v1";

// Провайдер OpenAI chat.completions со стримингом (SSE).
export class OpenAIProvider implements LLMProvider {
  constructor(private config: OpenAIConfig) {}

  async *complete(input: CompleteInput): AsyncIterable<string> {
    const base = (this.config.baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model?.trim() || DEFAULT_MODEL,
        stream: true,
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          ...input.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`OpenAI API: ${res.status} ${body.slice(0, 300)}`);
    }

    // Разбор SSE: строки «data: {json}», конец потока — «data: [DONE]».
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const delta = (JSON.parse(data) as { choices?: [{ delta?: { content?: string } }] }).choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // служебные или неполные строки пропускаем
        }
      }
    }
  }
}
