import { DraftProposalSchema, getDocumentType, type DraftProposal } from "@master-ai/shared";

const JSON_BLOCK = /```json\s*([\s\S]*?)```/gi;

export function parseProposals(text: string): { reply: string; proposals: DraftProposal[] } {
  const matches = [...text.matchAll(JSON_BLOCK)];
  if (matches.length === 0) return { reply: text, proposals: [] };

  const proposals: DraftProposal[] = [];
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1]) as { proposals?: unknown[] };
      for (const raw of parsed.proposals ?? []) {
        const draft = DraftProposalSchema.safeParse(raw);
        if (draft.success && getDocumentType(draft.data.type)) {
          proposals.push(draft.data);
        }
      }
    } catch {
      // битый JSON — пропускаем блок
    }
  }
  const reply = text.replace(JSON_BLOCK, "").trim();
  return { reply, proposals };
}
