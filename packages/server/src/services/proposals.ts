import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, DraftProposal, Proposal, ProposalStatus } from "@master-ai/shared";
import { proposals } from "../db/schema.js";
import type { DocumentService } from "./documents.js";

export function textToDoc(text: string): unknown {
  const paragraphs = text.split("\n").filter((line) => line.trim().length > 0);
  return {
    type: "doc",
    content: paragraphs.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

interface ProposalRow {
  id: string; campaignId: string; conversationId: string; type: string;
  title: string; content: string; fields: string; status: string; createdAt: string;
}

function toProposal(r: ProposalRow): Proposal {
  return { ...r, fields: JSON.parse(r.fields), status: r.status as ProposalStatus };
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
    const doc = documents.create({
      campaignId: p.campaignId,
      type: p.type,
      title: p.title,
      contentJson: textToDoc(p.content),
      fields: p.fields,
    });
    this.db.update(proposals).set({ status: "approved" }).where(eq(proposals.id, id)).run();
    return doc;
  }

  reject(id: string): Proposal | undefined {
    const p = this.get(id);
    if (!p) return undefined;
    this.db.update(proposals).set({ status: "rejected" }).where(eq(proposals.id, id)).run();
    return this.get(id);
  }
}
