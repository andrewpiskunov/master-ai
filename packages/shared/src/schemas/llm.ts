import { z } from "zod";

export const LlmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type LlmMessage = z.infer<typeof LlmMessageSchema>;

export const CompleteInputSchema = z.object({
  system: z.string().optional(),
  messages: z.array(LlmMessageSchema).min(1),
  // Кампания, от имени которой идёт запрос — сервер выбирает её нейросеть.
  campaignId: z.string().optional(),
});
export type CompleteInput = z.infer<typeof CompleteInputSchema>;

// Расход одного запроса к нейросети. estimated — цифры оценочные
// (провайдер не отдаёт usage, считаем по длине текста).
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  // Способ запроса: 'cli' (Claude Code) или 'openai' (совместимый API).
  provider?: string;
  model?: string;
  // Полное время ответа (от запроса до конца стрима), мс.
  durationMs?: number;
}

// Статистика расхода кампании: суммарно, по фичам и по моделям.
export interface LlmUsageStats {
  total: { promptTokens: number; completionTokens: number; requests: number; estimated: boolean; avgDurationMs: number };
  byFeature: Array<{
    feature: string;
    promptTokens: number;
    completionTokens: number;
    requests: number;
    estimated: boolean;
    avgDurationMs: number;
  }>;
  byModel: Array<{
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    requests: number;
    avgDurationMs: number;
  }>;
}

// Итоговая статистика по всему сайту: общий расход + разбивка по кампаниям.
export interface GlobalLlmUsageStats extends LlmUsageStats {
  byCampaign: Array<{
    campaignId: string;
    name: string;
    promptTokens: number;
    completionTokens: number;
    requests: number;
    estimated: boolean;
    avgDurationMs: number;
  }>;
}
