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
