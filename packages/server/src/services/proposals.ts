import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, DraftProposal, Proposal, ProposalStatus } from "@master-ai/shared";
import { proposals } from "../db/schema.js";
import type { DocumentService } from "./documents.js";

// Инлайн-разметка (**жирный**, *курсив*) → текстовые узлы ProseMirror.
function inlineNodes(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "text", text: m[1], marks: [{ type: "bold" }] });
    else out.push({ type: "text", text: m[2], marks: [{ type: "italic" }] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.length ? out : [{ type: "text", text }];
}

// Markdown-текст → JSON-документ ProseMirror (заголовки, списки, жирный/курсив, абзацы).
// Соответствует схеме StarterKit того же редактора, поэтому шаблоны рендерятся как структура.
export function textToDoc(md: string): unknown {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const content: Array<Record<string, unknown>> = [];
  for (let i = 0; i < lines.length; ) {
    const t = lines[i].trim();
    if (t === "") { i++; continue; }
    if (t.startsWith("### ")) { content.push({ type: "heading", attrs: { level: 3 }, content: inlineNodes(t.slice(4)) }); i++; continue; }
    if (t.startsWith("## ")) { content.push({ type: "heading", attrs: { level: 2 }, content: inlineNodes(t.slice(3)) }); i++; continue; }
    if (t.startsWith("# ")) { content.push({ type: "heading", attrs: { level: 2 }, content: inlineNodes(t.slice(2)) }); i++; continue; }
    if (/^[-*]\s+/.test(t)) {
      const items: Array<Record<string, unknown>> = [];
      for (; i < lines.length && /^[-*]\s+/.test(lines[i].trim()); i++) {
        items.push({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes(lines[i].trim().replace(/^[-*]\s+/, "")) }] });
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items: Array<Record<string, unknown>> = [];
      for (; i < lines.length && /^\d+\.\s+/.test(lines[i].trim()); i++) {
        items.push({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes(lines[i].trim().replace(/^\d+\.\s+/, "")) }] });
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }
    content.push({ type: "paragraph", content: inlineNodes(t) });
    i++;
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

interface ProposalRow {
  id: string; campaignId: string; conversationId: string; type: string;
  title: string; content: string; fields: string; action: string; status: string; createdAt: string;
}

function toProposal(r: ProposalRow): Proposal {
  return { ...r, fields: JSON.parse(r.fields), action: (r.action as Proposal["action"]) ?? "create", status: r.status as ProposalStatus };
}

export class ProposalService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: { campaignId: string; conversationId: string; draft: DraftProposal }): Proposal {
    const row: ProposalRow = {
      id: randomUUID(),
      campaignId: input.campaignId,
      conversationId: input.conversationId,
      type: input.draft.type,
      title: input.draft.title,
      content: input.draft.content,
      fields: JSON.stringify(input.draft.fields ?? {}),
      action: input.draft.action ?? "create",
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.db.insert(proposals).values(row).run();
    return toProposal(row);
  }

  listByCampaign(campaignId: string, status?: ProposalStatus): Proposal[] {
    const where = status
      ? and(eq(proposals.campaignId, campaignId), eq(proposals.status, status))
      : eq(proposals.campaignId, campaignId);
    return (this.db.select().from(proposals).where(where).all() as ProposalRow[]).map(toProposal);
  }

  get(id: string): Proposal | undefined {
    const r = this.db.select().from(proposals).where(eq(proposals.id, id)).get() as ProposalRow | undefined;
    return r ? toProposal(r) : undefined;
  }

  approve(id: string, documents: DocumentService): Document | undefined {
    const p = this.get(id);
    if (!p || p.status !== "pending") return undefined;
    return this.db.transaction(() => {
      // Правка существующего документа: ищем по точному названию в кампании.
      const existing = p.action === "update"
        ? documents.listByCampaign(p.campaignId).find((d) => d.title.toLowerCase() === p.title.toLowerCase())
        : undefined;
      const doc = existing
        ? documents.update(existing.id, { contentJson: textToDoc(p.content) })
        : documents.create({
            campaignId: p.campaignId,
            type: p.type,
            title: p.title,
            contentJson: textToDoc(p.content),
            fields: p.fields,
          });
      this.db.update(proposals).set({ status: "approved" }).where(eq(proposals.id, id)).run();
      return doc;
    });
  }

  reject(id: string): Proposal | undefined {
    const p = this.get(id);
    if (!p || p.status !== "pending") return undefined;
    this.db.update(proposals).set({ status: "rejected" }).where(eq(proposals.id, id)).run();
    return this.get(id);
  }
}
