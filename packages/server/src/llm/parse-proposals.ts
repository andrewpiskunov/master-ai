import { DraftProposalSchema, getDocumentType, type DraftProposal } from "@master-ai/shared";

const JSON_BLOCK = /```json\s*([\s\S]*?)```/gi;

// Экранирует «сырые» переводы строк и табы ВНУТРИ строковых литералов JSON —
// модели часто вставляют многострочный content без \n, что ломает JSON.parse.
function repairJsonStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

function parseBlock(raw: string): { proposals?: unknown[] } | null {
  try {
    return JSON.parse(raw) as { proposals?: unknown[] };
  } catch {
    try {
      return JSON.parse(repairJsonStrings(raw)) as { proposals?: unknown[] };
    } catch {
      return null;
    }
  }
}

export function parseProposals(text: string): { reply: string; proposals: DraftProposal[] } {
  const matches = [...text.matchAll(JSON_BLOCK)];
  if (matches.length === 0) return { reply: text, proposals: [] };

  const proposals: DraftProposal[] = [];
  for (const m of matches) {
    const parsed = parseBlock(m[1]);
    if (!parsed) continue;
    for (const raw of parsed.proposals ?? []) {
      const draft = DraftProposalSchema.safeParse(raw);
      if (draft.success && getDocumentType(draft.data.type)) {
        proposals.push(draft.data);
      }
    }
  }
  const reply = text.replace(JSON_BLOCK, "").trim();
  return { reply, proposals };
}
