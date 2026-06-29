import type { CompleteInput } from "@master-ai/shared";

export interface LLMProvider {
  complete(input: CompleteInput): AsyncIterable<string>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}
