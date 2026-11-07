import { z } from "zod";

export const LinkSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  fromDocId: z.string(),
  toDocId: z.string(),
  kind: z.string(),
});
export type Link = z.infer<typeof LinkSchema>;

export const NewLinkSchema = z.object({
  campaignId: z.string(),
  fromDocId: z.string(),
  toDocId: z.string(),
  kind: z.string().min(1),
});
export type NewLink = z.infer<typeof NewLinkSchema>;

// Связь в виде, удобном для UI: id связи, её вид и документ на другом конце.
export const LinkedDocumentSchema = z.object({
  linkId: z.string(),
  kind: z.string(),
  document: z.object({ id: z.string(), type: z.string(), title: z.string() }),
});
export type LinkedDocument = z.infer<typeof LinkedDocumentSchema>;

export const DocumentLinksSchema = z.object({
  outgoing: z.array(LinkedDocumentSchema),
  incoming: z.array(LinkedDocumentSchema),
});
export type DocumentLinks = z.infer<typeof DocumentLinksSchema>;
