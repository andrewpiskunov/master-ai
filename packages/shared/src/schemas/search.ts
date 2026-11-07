import { z } from "zod";

export const SearchHitSchema = z.object({
  docId: z.string(),
  type: z.string(),
  title: z.string(),
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;
