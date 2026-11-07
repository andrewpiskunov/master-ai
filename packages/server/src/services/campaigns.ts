import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Campaign, CampaignPatch, NewCampaign } from "@master-ai/shared";
import { campaigns, documents, links, proposals, conversations, messages } from "../db/schema.js";

type CampaignRow = typeof campaigns.$inferSelect;

// llm_settings хранится JSON-строкой — наружу отдаём распарсенный объект.
function toCampaign(row: CampaignRow): Campaign {
  return { ...row, llmSettings: JSON.parse(row.llmSettings) } as Campaign;
}

export class CampaignService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewCampaign): Campaign {
    const row: CampaignRow = {
      id: randomUUID(),
      name: input.name,
      system: input.system ?? null,
      description: input.description ?? null,
      realism: input.realism ?? "balanced",
      llmProvider: "cli",
      llmSettings: "{}",
      createdAt: new Date().toISOString(),
    };
    this.db.insert(campaigns).values(row).run();
    return toCampaign(row);
  }

  list(): Campaign[] {
    return (this.db.select().from(campaigns).all() as CampaignRow[]).map(toCampaign);
  }

  get(id: string): Campaign | undefined {
    const row = this.db.select().from(campaigns).where(eq(campaigns.id, id)).get() as CampaignRow | undefined;
    return row ? toCampaign(row) : undefined;
  }

  update(id: string, patch: CampaignPatch): Campaign | undefined {
    if (!this.get(id)) return undefined;
    const updates: Partial<CampaignRow> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.system !== undefined) updates.system = patch.system;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.realism !== undefined) updates.realism = patch.realism;
    if (patch.llmProvider !== undefined) updates.llmProvider = patch.llmProvider;
    if (patch.llmSettings !== undefined) updates.llmSettings = JSON.stringify(patch.llmSettings);
    if (Object.keys(updates).length) {
      this.db.update(campaigns).set(updates).where(eq(campaigns.id, id)).run();
    }
    return this.get(id);
  }

  // Удаляет кампанию и весь связанный контент (документы, связи, предложения,
  // беседа, сообщения, FTS-индекс) в одной транзакции.
  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.db.transaction(() => {
      const convIds = this.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.campaignId, id))
        .all()
        .map((c) => c.id);
      if (convIds.length) {
        this.db.delete(messages).where(inArray(messages.conversationId, convIds)).run();
      }
      this.db.delete(conversations).where(eq(conversations.campaignId, id)).run();
      this.db.delete(proposals).where(eq(proposals.campaignId, id)).run();
      this.db.delete(links).where(eq(links.campaignId, id)).run();
      this.db.delete(documents).where(eq(documents.campaignId, id)).run();
      this.db.run(sql`DELETE FROM documents_fts WHERE campaign_id = ${id}`);
      this.db.delete(campaigns).where(eq(campaigns.id, id)).run();
    });
    return true;
  }
}
