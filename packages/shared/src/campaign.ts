import { z } from "zod";

export const RealismSchema = z.enum(["stylized", "balanced", "realistic"]);
export type Realism = z.infer<typeof RealismSchema>;

// Нейросеть кампании: локальный Claude Code (cli) или OpenAI-совместимый API.
export const LlmProviderSchema = z.enum(["cli", "openai"]);
export type LlmProviderKind = z.infer<typeof LlmProviderSchema>;

export const LlmSettingsSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  // Базовый URL для OpenAI-совместимых API (OpenRouter, локальные модели и т.п.).
  baseUrl: z.string().optional(),
});
export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  system: z.string().nullable(),
  description: z.string().nullable(),
  realism: RealismSchema,
  llmProvider: LlmProviderSchema,
  llmSettings: LlmSettingsSchema,
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const NewCampaignSchema = z.object({
  name: z.string().min(1),
  system: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  realism: RealismSchema.optional(),
});
export type NewCampaign = z.infer<typeof NewCampaignSchema>;

export const CampaignPatchSchema = z.object({
  name: z.string().min(1).optional(),
  system: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  realism: RealismSchema.optional(),
  llmProvider: LlmProviderSchema.optional(),
  llmSettings: LlmSettingsSchema.optional(),
});
export type CampaignPatch = z.infer<typeof CampaignPatchSchema>;

// Подсказка для промта ИИ: насколько «реалистичным» должен быть тон материалов.
export function realismHint(realism: Realism): string {
  switch (realism) {
    case "stylized":
      return "Тон — стилизованный, героический и яркий: смелые образы, выразительные детали, без приземлённости.";
    case "realistic":
      return "Тон — приземлённый и реалистичный: достоверная логика, последствия, бытовые детали, минимум пафоса и условностей.";
    default:
      return "Тон — сбалансированный: живо и образно, но с правдоподобной логикой и последствиями.";
  }
}
