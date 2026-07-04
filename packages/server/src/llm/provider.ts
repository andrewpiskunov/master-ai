import type { CompleteInput, LlmUsage } from "@master-ai/shared";

export interface CompleteOptions {
  // Вызывается после успешного завершения стрима с расходом токенов запроса.
  onUsage?: (usage: LlmUsage) => void;
  // Сигнал остановки: провайдер обязан оборвать генерацию немедленно
  // (убить CLI-процесс, прервать HTTP-запрос), а не ждать следующего чанка.
  signal?: AbortSignal;
}

export interface LLMProvider {
  complete(input: CompleteInput, opts?: CompleteOptions): AsyncIterable<string>;
}

// Оценка числа токенов по длине текста (для провайдеров без usage):
// для русского текста ~3 символа на токен.
export function estimateTokens(textOrLength: string | number): number {
  const len = typeof textOrLength === "number" ? textOrLength : textOrLength.length;
  return Math.ceil(len / 3);
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}
