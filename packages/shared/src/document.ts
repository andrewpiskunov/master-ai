import { z } from "zod";

export const DocumentSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  contentJson: z.unknown(),
  fields: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const NewDocumentSchema = z.object({
  campaignId: z.string(),
  type: z.string(),
  title: z.string().min(1),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
});
export type NewDocument = z.infer<typeof NewDocumentSchema>;
