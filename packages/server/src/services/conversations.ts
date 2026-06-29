import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ConversationMessage } from "@master-ai/shared";
import { conversations, messages } from "../db/schema.js";

export class ConversationService {
  constructor(private db: BetterSQLite3Database) {}

  getOrCreateForCampaign(campaignId: string): { id: string } {
    const existing = this.db.select().from(conversations).where(eq(conversations.campaignId, campaignId)).get();
    if (existing) return { id: existing.id };
    const row = { id: randomUUID(), campaignId, createdAt: new Date().toISOString() };
    this.db.insert(conversations).values(row).run();
    return { id: row.id };
  }

  addMessage(conversationId: string, role: "user" | "assistant", content: string): ConversationMessage {
    const row = { id: randomUUID(), conversationId, role, content, createdAt: new Date().toISOString() };
    this.db.insert(messages).values(row).run();
    return { id: row.id, role, content, createdAt: row.createdAt };
  }

  listMessages(conversationId: string): ConversationMessage[] {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all();
    return rows.map((r) => ({ id: r.id, role: r.role as "user" | "assistant", content: r.content, createdAt: r.createdAt }));
  }
}
