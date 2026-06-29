import { z } from "zod";

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  system: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const NewCampaignSchema = z.object({
  name: z.string().min(1),
  system: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type NewCampaign = z.infer<typeof NewCampaignSchema>;
