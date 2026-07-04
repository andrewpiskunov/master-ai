import type { CompleteInput } from "@master-ai/shared";
import { type CompleteOptions, type LLMProvider, estimateTokens } from "./provider.js";

export class FakeProvider implements LLMProvider {
  constructor(private chunks: string[]) {}

  async *complete(input: CompleteInput, opts?: CompleteOptions): AsyncIterable<string> {
    let outChars = 0;
    for (const chunk of this.chunks) {
      outChars += chunk.length;
      yield chunk;
    }
    const promptChars = (input.system ?? "").length + input.messages.reduce((n, m) => n + m.content.length, 0);
    opts?.onUsage?.({
      promptTokens: estimateTokens(promptChars),
      completionTokens: estimateTokens(outChars),
      estimated: true,
      provider: "fake",
      model: "fake",
      durationMs: 0,
    });
  }
}
