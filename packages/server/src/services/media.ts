import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { ImageIdsSchema, ImageUploadSchema, MAX_IMAGE_BYTES, type ImageAttachment, type LlmImage } from "@master-ai/shared";
import { campaigns, documentImages, documents, images } from "../db/schema.js";

export class MediaError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

type ImageRow = typeof images.$inferSelect;
const attachment = (row: ImageRow): ImageAttachment => ({ id: row.id, name: row.name, mimeType: row.mimeType as ImageAttachment["mimeType"] });

// Проверяем и MIME в data URL, и сигнатуру самих байтов. SVG не принимается.
export function validateImage(input: { name: string; dataUrl: string }): { name: string; mimeType: ImageAttachment["mimeType"]; dataUrl: string } {
  const parsed = ImageUploadSchema.safeParse(input);
  if (!parsed.success) throw new MediaError("Ожидается PNG, JPEG или WebP размером до 10 МиБ");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(parsed.data.dataUrl);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw new MediaError("Некорректные данные изображения");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new MediaError("Изображение больше 10 МиБ");
  if (bytes.toString("base64") !== match[2]) throw new MediaError("Некорректный base64 изображения");
  const mimeType = match[1] as ImageAttachment["mimeType"];
  const valid = mimeType === "image/png"
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    : mimeType === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new MediaError("Содержимое файла не соответствует формату изображения");
  return { name: parsed.data.name, mimeType, dataUrl: parsed.data.dataUrl };
}

export class MediaService {
  constructor(private db: BetterSQLite3Database) {}

  create(campaignId: string, input: { name: string; dataUrl: string }): ImageAttachment {
    if (!this.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).get()) throw new MediaError("кампания не найдена", 404);
    const value = validateImage(input);
    const row = { id: randomUUID(), campaignId, ...value, createdAt: new Date().toISOString() };
    this.db.insert(images).values(row).run();
    return attachment(row);
  }

  // Импорт и привязка атомарны; повторная обработка ответа ИИ не плодит файлы.
  importForDocument(documentId: string, input: LlmImage): ImageAttachment {
    const doc = this.document(documentId);
    const value = validateImage(input);
    return this.db.transaction(() => {
      const existing = this.db.select().from(images)
        .where(and(eq(images.campaignId, doc.campaignId), eq(images.dataUrl, value.dataUrl))).get();
      const image = existing ? attachment(existing) : this.create(doc.campaignId, input);
      this.attach(documentId, image.id);
      return image;
    });
  }

  get(id: string): ImageRow | undefined {
    return this.db.select().from(images).where(eq(images.id, id)).get();
  }

  getForCampaign(campaignId: string, ids: string[]): ImageAttachment[] {
    const parsed = ImageIdsSchema.safeParse(ids);
    if (!parsed.success) throw new MediaError("Можно прикрепить до четырёх изображений");
    return [...new Set(parsed.data)].map((id) => {
      const row = this.get(id);
      if (!row || row.campaignId !== campaignId) throw new MediaError("Изображение не найдено в этой кампании");
      return attachment(row);
    });
  }

  toLlmImages(campaignId: string, refs?: ImageAttachment[]): LlmImage[] {
    return this.getForCampaign(campaignId, (refs ?? []).map((ref) => ref.id)).map((ref) => {
      const row = this.get(ref.id)!;
      return { name: row.name, dataUrl: row.dataUrl };
    });
  }

  private document(id: string) {
    const doc = this.db.select({ id: documents.id, campaignId: documents.campaignId }).from(documents).where(eq(documents.id, id)).get();
    if (!doc) throw new MediaError("документ не найден", 404);
    return doc;
  }

  listForDocument(docId: string): ImageAttachment[] {
    const doc = this.document(docId);
    return this.db.select({ image: images }).from(documentImages).innerJoin(images, eq(images.id, documentImages.imageId))
      .where(and(eq(documentImages.documentId, docId), eq(images.campaignId, doc.campaignId))).all().map(({ image }) => attachment(image));
  }

  attach(docId: string, imageId: string): ImageAttachment[] {
    const doc = this.document(docId);
    this.getForCampaign(doc.campaignId, [imageId]);
    this.db.insert(documentImages).values({ documentId: docId, imageId }).onConflictDoNothing().run();
    return this.listForDocument(docId);
  }

  detach(docId: string, imageId: string): ImageAttachment[] {
    const doc = this.document(docId);
    this.getForCampaign(doc.campaignId, [imageId]);
    this.db.delete(documentImages).where(and(eq(documentImages.documentId, docId), eq(documentImages.imageId, imageId))).run();
    return this.listForDocument(docId);
  }
}
