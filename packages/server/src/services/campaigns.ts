import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Campaign, CampaignPatch, ImageAttachment, NewCampaign } from "@master-ai/shared";
import { campaigns, documents, images, links, proposals, conversations, messages } from "../db/schema.js";

type CampaignRow = typeof campaigns.$inferSelect;

// llm_settings хранится JSON-строкой — наружу отдаём распарсенный объект.
function toCampaign(row: CampaignRow, cover: ImageAttachment | null = null, updatedAt = row.updatedAt): Campaign {
  const { coverImageId: _coverImageId, ...campaign } = row;
  return { ...campaign, cover, updatedAt, llmSettings: JSON.parse(row.llmSettings) } as Campaign;
}

export class CampaignService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewCampaign): Campaign {
    const now = new Date().toISOString();
    const row: CampaignRow = {
      id: randomUUID(),
      name: input.name,
      system: input.system ?? null,
      description: input.description ?? null,
      realism: input.realism ?? "balanced",
      llmProvider: "cli",
      llmSettings: "{}",
      createdAt: now,
      updatedAt: now,
      coverImageId: null,
    };
    this.db.insert(campaigns).values(row).run();
    return toCampaign(row);
  }

  list(): Campaign[] {
    return this.read();
  }

  get(id: string): Campaign | undefined {
    return this.read(id)[0];
  }

  // Обложка — только явный выбор мастера. Список получает метаданные медиа и
  // максимальную дату документов одним запросом, без чтения их текста или байтов.
  private read(id?: string): Campaign[] {
    const activity = this.db.select({
      campaignId: documents.campaignId,
      updatedAt: sql<string>`max(${documents.updatedAt})`.as("latest_document_update"),
    }).from(documents).groupBy(documents.campaignId).as("document_activity");
    const rows = this.db.select({
      campaign: campaigns,
      cover: { id: images.id, name: images.name, mimeType: images.mimeType },
      updatedAt: sql<string>`max(${campaigns.updatedAt}, coalesce(${activity.updatedAt}, ${campaigns.updatedAt}))`,
    }).from(campaigns)
      .leftJoin(images, and(eq(images.id, campaigns.coverImageId), eq(images.campaignId, campaigns.id)))
      .leftJoin(activity, eq(activity.campaignId, campaigns.id))
      .where(id === undefined ? undefined : eq(campaigns.id, id)).all();
    return rows.map((row) => toCampaign(row.campaign, row.cover as ImageAttachment | null, row.updatedAt));
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
      updates.updatedAt = new Date().toISOString();
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
      this.db.run(sql`DELETE FROM document_images WHERE document_id IN (SELECT id FROM documents WHERE campaign_id = ${id}) OR image_id IN (SELECT id FROM images WHERE campaign_id = ${id})`);
      this.db.delete(images).where(eq(images.campaignId, id)).run();
      this.db.delete(documents).where(eq(documents.campaignId, id)).run();
      this.db.run(sql`DELETE FROM documents_fts WHERE campaign_id = ${id}`);
      this.db.delete(campaigns).where(eq(campaigns.id, id)).run();
    });
    return true;
  }
}
