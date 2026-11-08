import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ConversationMessage, MessageMeta } from "@master-ai/shared";
import { conversations, messages } from "../db/schema.js";

export class ConversationService {
  constructor(private db: BetterSQLite3Database) {}

  // Беседа Мастерской — одна на кампанию (documentId IS NULL).
  getOrCreateForCampaign(campaignId: string): { id: string } {
    const existing = this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.campaignId, campaignId), isNull(conversations.documentId)))
      .get();
    if (existing) return { id: existing.id };
    const row = { id: randomUUID(), campaignId, documentId: null, createdAt: new Date().toISOString() };
    this.db.insert(conversations).values(row).run();
    return { id: row.id };
  }

  // Беседа ассистента — одна на документ.
  getOrCreateForDocument(campaignId: string, documentId: string): { id: string } {
    const existing = this.db
      .select()
      .from(conversations)
      .where(eq(conversations.documentId, documentId))
      .get();
    if (existing) return { id: existing.id };
    const row = { id: randomUUID(), campaignId, documentId, createdAt: new Date().toISOString() };
    this.db.insert(conversations).values(row).run();
    return { id: row.id };
  }

  addMessage(conversationId: string, role: "user" | "assistant", content: string, meta?: MessageMeta): ConversationMessage {
    const row = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      meta: JSON.stringify(meta ?? {}),
      createdAt: new Date().toISOString(),
    };
    this.db.insert(messages).values(row).run();
    return { id: row.id, role, content, meta: meta ?? {}, createdAt: row.createdAt };
  }

  // Очищает беседу ассистента документа: сообщения и саму беседу
  // (при следующем обращении она создастся заново пустой).
  clearForDocument(documentId: string): void {
    const conv = this.db
      .select()
      .from(conversations)
      .where(eq(conversations.documentId, documentId))
      .get();
    if (!conv) return;
    this.db.delete(messages).where(eq(messages.conversationId, conv.id)).run();
    this.db.delete(conversations).where(eq(conversations.id, conv.id)).run();
  }

  // Точечное обновление меты сообщения (например, переключение важности записи лога).
  updateMessageMeta(messageId: string, patch: Partial<MessageMeta>): ConversationMessage | null {
    const row = this.db.select().from(messages).where(eq(messages.id, messageId)).get();
    if (!row) return null;
    const meta = { ...parseMeta(row.meta), ...patch };
    this.db.update(messages).set({ meta: JSON.stringify(meta) }).where(eq(messages.id, messageId)).run();
    return { id: row.id, role: row.role as "user" | "assistant", content: row.content, meta, createdAt: row.createdAt };
  }

  listMessages(conversationId: string): ConversationMessage[] {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      // Несколько реплик и граница темы могут иметь одинаковую миллисекунду.
      .orderBy(asc(messages.createdAt), asc(sql`rowid`))
      .all();
    return rows.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      meta: parseMeta(r.meta),
      createdAt: r.createdAt,
    }));
  }
}

// Мета хранится JSON-строкой; повреждённое значение не должно ронять выдачу беседы.
function parseMeta(raw: string): MessageMeta {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as MessageMeta) : {};
  } catch {
    return {};
  }
}
