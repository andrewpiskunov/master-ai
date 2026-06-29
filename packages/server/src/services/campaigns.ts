import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Campaign, NewCampaign } from "@master-ai/shared";
import { campaigns, documents, links, proposals, conversations, messages } from "../db/schema.js";

export class CampaignService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewCampaign): Campaign {
    const row: Campaign = {
      id: randomUUID(),
      name: input.name,
      system: input.system ?? null,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(campaigns).values(row).run();
    return row;
  }

  list(): Campaign[] {
    return this.db.select().from(campaigns).all();
  }

  get(id: string): Campaign | undefined {
    return this.db.select().from(campaigns).where(eq(campaigns.id, id)).get();
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
