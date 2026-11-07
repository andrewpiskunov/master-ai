import { DraftProposalSchema, WorkshopImageRequestsSchema, getDocumentType, type DraftProposal, type WorkshopImageRequest } from "@master-ai/shared";

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

function parseBlock(raw: string): Record<string, unknown> | null {
  const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  try {
    return object(JSON.parse(raw));
  } catch {
    try {
      return object(JSON.parse(repairJsonStrings(raw)));
    } catch {
      return null;
    }
  }
}

const INVALID_IMAGES_MESSAGE = "Не удалось обработать прикрепление изображений: ИИ вернул неверный формат или больше 50 изображений. Повторите запрос меньшей группой.";

// Assistants also return ordinary JSON and doc/edit-doc/log fences. Remove only
// image controls, retaining any unrelated fields from a mixed JSON block.
export function parseImageActions(text: string): { reply: string; imageAttachments: WorkshopImageRequest[] } {
  let imageAttachments: WorkshopImageRequest[] = [];
  let invalidImages = false;
  let reply = text.replace(JSON_BLOCK, (block: string, raw: string) => {
    const parsed = parseBlock(raw);
    if (!parsed) {
      if (!raw.includes('"imageAttachments"')) return block;
      invalidImages = true;
      return "";
    }
    if (!("imageAttachments" in parsed)) return block;
    const batch = WorkshopImageRequestsSchema.safeParse(parsed.imageAttachments);
    if (!batch.success || imageAttachments.length + batch.data.length > 50) invalidImages = true;
    else imageAttachments.push(...batch.data);
    const { imageAttachments: _actions, ...rest } = parsed;
    return Object.keys(rest).length ? `\`\`\`json\n${JSON.stringify(rest, null, 2)}\n\`\`\`` : "";
  }).trim();
  if (invalidImages) {
    imageAttachments = [];
    reply += `\n\n${INVALID_IMAGES_MESSAGE}`;
  }
  return { reply: reply.trim(), imageAttachments };
}

export function parseProposals(text: string): { reply: string; proposals: DraftProposal[]; imageAttachments: WorkshopImageRequest[] } {
  const matches = [...text.matchAll(JSON_BLOCK)];
  if (matches.length === 0) return { reply: text, proposals: [], imageAttachments: [] };

  const proposals: DraftProposal[] = [];
  let imageAttachments: WorkshopImageRequest[] = [];
  let invalidImages = false;
  for (const m of matches) {
    const parsed = parseBlock(m[1]);
    if (!parsed) {
      if (m[1].includes('"imageAttachments"')) invalidImages = true;
      continue;
    }
    for (const raw of Array.isArray(parsed.proposals) ? parsed.proposals : []) {
      const draft = DraftProposalSchema.safeParse(raw);
      if (draft.success && getDocumentType(draft.data.type)) {
        proposals.push(draft.data);
      }
    }
    if (parsed.imageAttachments !== undefined) {
      const batch = WorkshopImageRequestsSchema.safeParse(parsed.imageAttachments);
      if (!batch.success || imageAttachments.length + batch.data.length > 50) invalidImages = true;
      else imageAttachments.push(...batch.data);
    }
  }
  let reply = text.replace(JSON_BLOCK, "").trim();
  if (invalidImages) {
    imageAttachments = [];
    reply += `\n\n${INVALID_IMAGES_MESSAGE}`;
  }
  return { reply: reply.trim(), proposals, imageAttachments };
}
