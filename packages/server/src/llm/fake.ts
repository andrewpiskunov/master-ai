import type { CompleteInput } from "@master-ai/shared";
import type { LLMProvider } from "./provider.js";

export class FakeProvider implements LLMProvider {
  constructor(private chunks: string[]) {}

  async *complete(_input: CompleteInput): AsyncIterable<string> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}
