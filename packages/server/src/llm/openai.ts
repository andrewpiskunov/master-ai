import type { CompleteInput } from "@master-ai/shared";
import { type CompleteOptions, type LLMProvider, LlmError, estimateTokens } from "./provider.js";

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

  async *complete(input: CompleteInput, opts?: CompleteOptions): AsyncIterable<string> {
    const startedAt = Date.now();
    const base = (this.config.baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
    const model = this.config.model?.trim() || DEFAULT_MODEL;
    const body = (withUsage: boolean) => JSON.stringify({
      model,
      stream: true,
      // Просим usage в конце стрима; часть совместимых API поля не знает — тогда повторяем без него.
      ...(withUsage ? { stream_options: { include_usage: true } } : {}),
      messages: [
        ...(input.system ? [{ role: "system", content: input.system }] : []),
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    const request = (withUsage: boolean) => fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: body(withUsage),
      signal: opts?.signal,
    });

    let res = await request(true);
    if (!res.ok && res.status >= 400 && res.status < 500) {
      res = await request(false);
    }
    if (!res.ok || !res.body) {
      const errBody = await res.text().catch(() => "");
      throw new LlmError(`OpenAI API: ${res.status} ${errBody.slice(0, 300)}`);
    }

    // Разбор SSE: строки «data: {json}», конец потока — «data: [DONE]».
    const decoder = new TextDecoder();
    let buf = "";
    let outChars = 0;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const durationMs = Date.now() - startedAt;
      if (usage && typeof usage.prompt_tokens === "number") {
        opts?.onUsage?.({
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens ?? 0,
          estimated: false,
          provider: "openai",
          model,
          durationMs,
        });
      } else {
        const promptChars = (input.system ?? "").length + input.messages.reduce((n, m) => n + m.content.length, 0);
        opts?.onUsage?.({
          promptTokens: estimateTokens(promptChars),
          completionTokens: estimateTokens(outChars),
          estimated: true,
          provider: "openai",
          model,
          durationMs,
        });
      }
    };
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            finish();
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              choices?: [{ delta?: { content?: string } }];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            if (parsed.usage) usage = parsed.usage;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              outChars += delta.length;
              yield delta;
            }
          } catch {
            // служебные или неполные строки пропускаем
          }
        }
      }
    } catch (e) {
      // Остановка по сигналу — штатное завершение: учитываем частичный расход и выходим.
      if (opts?.signal?.aborted) {
        finish();
        return;
      }
      throw e;
    }
    finish();
  }
}
