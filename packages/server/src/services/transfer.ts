import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import type { Campaign } from "@master-ai/shared";
import { campaigns, conversations, documents, links, llmUsage, messages, proposals } from "../db/schema.js";
import { proseMirrorToText } from "./prosemirror-text.js";

// Полный перенос кампании: экспорт всего содержимого в один JSON и импорт из него.
// Формат единый и самодостаточный: кампания, документы, беседы, сообщения,
// предложения, связи и статистика расхода нейросети — всё, что происходило.

export const TRANSFER_FORMAT = "master-ai-campaign";
export const TRANSFER_VERSION = 1;

const Row = z.object({ id: z.string().min(1) }).passthrough();

const TransferSchema = z.object({
  format: z.literal(TRANSFER_FORMAT),
  version: z.literal(TRANSFER_VERSION),
  exportedAt: z.string().optional(),
  campaign: z.object({
    name: z.string().min(1),
    system: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    realism: z.string().optional(),
    llmProvider: z.string().optional(),
    llmSettings: z.record(z.unknown()).optional(),
    createdAt: z.string().optional(),
  }).passthrough(),
  documents: z.array(Row).default([]),
  conversations: z.array(Row).default([]),
  messages: z.array(Row).default([]),
  proposals: z.array(Row).default([]),
  links: z.array(Row).default([]),
  llmUsage: z.array(Row).default([]),
});
export type CampaignTransfer = z.infer<typeof TransferSchema>;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const jsonStr = (v: unknown, fallback: string): string => (v === undefined ? fallback : JSON.stringify(v));

export class TransferService {
  constructor(private db: BetterSQLite3Database) {}

  // Экспорт кампании целиком. Ключ API нейросети НЕ выгружается — секреты не должны
  // утекать в файл; после импорта его нужно ввести заново.
  export(campaignId: string): CampaignTransfer | undefined {
    const campaign = this.db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
    if (!campaign) return undefined;
    const docs = this.db.select().from(documents).where(eq(documents.campaignId, campaignId)).all();
    const convs = this.db.select().from(conversations).where(eq(conversations.campaignId, campaignId)).all();
    const convIds = convs.map((c) => c.id);
    const msgs = convIds.length
      ? this.db.select().from(messages).where(inArray(messages.conversationId, convIds)).all()
      : [];
    const props = this.db.select().from(proposals).where(eq(proposals.campaignId, campaignId)).all();
    const lnks = this.db.select().from(links).where(eq(links.campaignId, campaignId)).all();
    const usage = this.db.select().from(llmUsage).where(eq(llmUsage.campaignId, campaignId)).all();

    const { apiKey: _secret, ...llmSettings } = JSON.parse(campaign.llmSettings) as Record<string, unknown>;
    return {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      campaign: {
        name: campaign.name,
        system: campaign.system,
        description: campaign.description,
        realism: campaign.realism,
        llmProvider: campaign.llmProvider,
        llmSettings,
        createdAt: campaign.createdAt,
      },
      documents: docs.map((d) => ({ ...d, contentJson: JSON.parse(d.contentJson), fields: JSON.parse(d.fields) })),
      conversations: convs,
      messages: msgs.map((m) => ({ ...m, meta: JSON.parse(m.meta) })),
      proposals: props.map((p) => ({ ...p, fields: JSON.parse(p.fields) })),
      links: lnks,
      llmUsage: usage,
    };
  }

  // Импорт как НОВАЯ кампания: все id генерируются заново и перевязываются,
  // чтобы импорт рядом с оригиналом не конфликтовал. Времена сохраняются из файла.
  import(raw: unknown): Campaign {
    const data = TransferSchema.parse(raw);
    const now = new Date().toISOString();
    const campaignId = randomUUID();

    // Карты старый id → новый для документов и бесед.
    const docId = new Map<string, string>();
    for (const d of data.documents) docId.set(d.id, randomUUID());
    const convId = new Map<string, string>();
    for (const c of data.conversations) convId.set(c.id, randomUUID());
    const mapDoc = (v: unknown): string | null => (typeof v === "string" ? docId.get(v) ?? null : null);

    const campaignRow = {
      id: campaignId,
      name: data.campaign.name,
      system: data.campaign.system ?? null,
      description: data.campaign.description ?? null,
      realism: data.campaign.realism ?? "balanced",
      llmProvider: data.campaign.llmProvider ?? "cli",
      llmSettings: jsonStr(data.campaign.llmSettings, "{}"),
      createdAt: str(data.campaign.createdAt, now),
    };

    this.db.transaction((tx) => {
      tx.insert(campaigns).values(campaignRow).run();

      for (const d of data.documents) {
        // Ссылки на сессии в fields указывают на документы — перевязываем на новые id.
        const fields = { ...(d.fields as Record<string, unknown> | undefined ?? {}) };
        if ("prevSessionId" in fields) fields.prevSessionId = mapDoc(fields.prevSessionId) ?? undefined;
        if ("nextSessionId" in fields) fields.nextSessionId = mapDoc(fields.nextSessionId) ?? undefined;
        const row = {
          id: docId.get(d.id)!,
          campaignId,
          type: str(d.type, "note"),
          title: str(d.title, "(без названия)"),
          status: typeof d.status === "string" ? d.status : null,
          contentJson: jsonStr(d.contentJson, "null"),
          fields: JSON.stringify(fields),
          createdAt: str(d.createdAt, now),
          updatedAt: str(d.updatedAt, now),
        };
        tx.insert(documents).values(row).run();
        const body = proseMirrorToText(JSON.parse(row.contentJson));
        tx.run(sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES (${row.id}, ${campaignId}, ${row.type}, ${row.title}, ${body})`);
      }

      for (const c of data.conversations) {
        tx.insert(conversations).values({
          id: convId.get(c.id)!,
          campaignId,
          documentId: mapDoc(c.documentId),
          createdAt: str(c.createdAt, now),
        }).run();
      }

      for (const m of data.messages) {
        const cid = typeof m.conversationId === "string" ? convId.get(m.conversationId) : undefined;
        if (!cid) continue; // сообщение осиротевшей беседы — пропускаем
        tx.insert(messages).values({
          id: randomUUID(),
          conversationId: cid,
          role: str(m.role, "user"),
          content: str(m.content),
          meta: jsonStr(m.meta, "{}"),
          createdAt: str(m.createdAt, now),
        }).run();
      }

      for (const p of data.proposals) {
        const cid = typeof p.conversationId === "string" ? convId.get(p.conversationId) : undefined;
        if (!cid) continue;
        tx.insert(proposals).values({
          id: randomUUID(),
          campaignId,
          conversationId: cid,
          type: str(p.type, "note"),
          title: str(p.title, "(без названия)"),
          content: str(p.content),
          fields: jsonStr(p.fields, "{}"),
          action: str(p.action, "create"),
          status: str(p.status, "pending"),
          createdAt: str(p.createdAt, now),
        }).run();
      }

      for (const l of data.links) {
        const from = mapDoc(l.fromDocId);
        const to = mapDoc(l.toDocId);
        if (!from || !to) continue; // связь на несуществующий документ
        tx.insert(links).values({ id: randomUUID(), campaignId, fromDocId: from, toDocId: to, kind: str(l.kind, "упоминает") }).run();
      }

      for (const u of data.llmUsage) {
        tx.insert(llmUsage).values({
          id: randomUUID(),
          campaignId,
          feature: str(u.feature, "other"),
          model: typeof u.model === "string" ? u.model : null,
          promptTokens: num(u.promptTokens),
          completionTokens: num(u.completionTokens),
          estimated: num(u.estimated) === 1 || u.estimated === true ? 1 : 0,
          provider: typeof u.provider === "string" ? u.provider : null,
          durationMs: typeof u.durationMs === "number" ? u.durationMs : null,
          createdAt: str(u.createdAt, now),
        }).run();
      }
    });

    return {
      ...campaignRow,
      system: campaignRow.system,
      llmProvider: campaignRow.llmProvider as Campaign["llmProvider"],
      realism: campaignRow.realism as Campaign["realism"],
      llmSettings: JSON.parse(campaignRow.llmSettings) as Campaign["llmSettings"],
    };
  }
}
