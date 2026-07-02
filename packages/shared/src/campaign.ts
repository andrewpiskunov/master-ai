import { z } from "zod";

export const RealismSchema = z.enum(["stylized", "balanced", "realistic"]);
export type Realism = z.infer<typeof RealismSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  system: z.string().nullable(),
  description: z.string().nullable(),
  realism: RealismSchema,
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
