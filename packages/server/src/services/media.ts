import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import sharp from "sharp";
import { ImageIdsSchema, ImageUploadSchema, MAX_IMAGE_BYTES, type ImageAttachment, type LlmImage } from "@master-ai/shared";
import { campaigns, conversations, documentImages, documents, images, imageThumbnails, messages } from "../db/schema.js";
import { generatedImageName, repairImageNames } from "../db/image-names.js";

export class MediaError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

type ImageRow = typeof images.$inferSelect;
const attachment = (row: Pick<ImageRow, "id" | "name" | "mimeType">): ImageAttachment => ({ id: row.id, name: row.name, mimeType: row.mimeType as ImageAttachment["mimeType"] });
export type ThumbnailSize = 128 | 256 | 512 | 1024;
type Thumbnail = { data: Buffer; etag: string };
// Меняем ключ при изменении формата или параметров, чтобы не отдавать старый вариант.
const THUMBNAIL_VERSION = "webp-v1-q78";
export const imageEtag = (data: Buffer): string => `"${createHash("sha256").update(data).digest("base64url")}"`;

function jsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

const hasImageId = (value: unknown, id: string): boolean =>
  value !== null && typeof value === "object" && "id" in value && value.id === id;

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
  private thumbnailsInFlight = new Map<string, Promise<Thumbnail | undefined>>();

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
      const image = existing ? attachment(existing) : this.create(doc.campaignId, {
        ...input, name: generatedImageName(doc.title, doc.type, value.mimeType),
      });
      return this.attach(documentId, image.id).find((attached) => attached.id === image.id)!;
    });
  }

  get(id: string): ImageRow | undefined {
    return this.db.select().from(images).where(eq(images.id, id)).get();
  }

  getMetadata(id: string): Pick<ImageRow, "id" | "name" | "mimeType" | "campaignId"> | undefined {
    return this.db.select({ id: images.id, name: images.name, mimeType: images.mimeType, campaignId: images.campaignId })
      .from(images).where(eq(images.id, id)).get();
  }

  delete(id: string): boolean {
    return this.db.transaction((tx) => {
      // Для удаления нужны только владелец и ссылки, без чтения исходных байтов.
      const image = tx.select({ campaignId: images.campaignId }).from(images).where(eq(images.id, id)).get();
      if (!image) return false;
      const now = new Date().toISOString();
      tx.delete(documentImages).where(eq(documentImages.imageId, id)).run();
      for (const doc of tx.select({ id: documents.id, fields: documents.fields }).from(documents)
        .where(eq(documents.campaignId, image.campaignId)).all()) {
        const fields = jsonObject(doc.fields);
        if (fields?.avatarImageId !== id) continue;
        delete fields.avatarImageId;
        tx.update(documents).set({ fields: JSON.stringify(fields), updatedAt: now }).where(eq(documents.id, doc.id)).run();
      }
      tx.update(campaigns).set({ coverImageId: null, updatedAt: now })
        .where(and(eq(campaigns.id, image.campaignId), eq(campaigns.coverImageId, id))).run();
      const history = tx.select({ id: messages.id, meta: messages.meta }).from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(eq(conversations.campaignId, image.campaignId)).all();
      for (const message of history) {
        const meta = jsonObject(message.meta);
        if (!meta) continue;
        let changed = false;
        for (const key of ["images", "imageAttachments"] as const) {
          const refs = meta[key];
          if (!Array.isArray(refs)) continue;
          const remaining = refs.filter((ref: unknown) => !hasImageId(key === "images" ? ref
            : ref !== null && typeof ref === "object" && "image" in ref ? ref.image : undefined, id));
          if (remaining.length !== refs.length) { meta[key] = remaining; changed = true; }
        }
        // Не переписываем JSON без нужды: сохраняем и неизвестные поля, и формат.
        if (changed) tx.update(messages).set({ meta: JSON.stringify(meta) }).where(eq(messages.id, message.id)).run();
      }
      // Триггер удаляет миниатюры; отложенный Sharp не сможет создать их заново.
      tx.delete(images).where(eq(images.id, id)).run();
      return true;
    });
  }

  private cachedThumbnail(id: string, size: ThumbnailSize): Thumbnail | undefined {
    // На попадании в кэш исходный data_url даже не читается из SQLite.
    return this.db.select({ data: imageThumbnails.data, etag: imageThumbnails.etag })
      .from(imageThumbnails).innerJoin(images, eq(images.id, imageThumbnails.imageId))
      .where(and(eq(imageThumbnails.imageId, id), eq(imageThumbnails.size, size), eq(imageThumbnails.version, THUMBNAIL_VERSION))).get();
  }

  async getThumbnail(id: string, size: ThumbnailSize): Promise<Thumbnail | undefined> {
    const cached = this.cachedThumbnail(id, size);
    if (cached) return cached;
    const key = `${id}:${size}:${THUMBNAIL_VERSION}`;
    const pending = this.thumbnailsInFlight.get(key);
    if (pending) return pending;
    const generation = this.renderThumbnail(id, size);
    this.thumbnailsInFlight.set(key, generation);
    try { return await generation; }
    finally { this.thumbnailsInFlight.delete(key); }
  }

  private async renderThumbnail(id: string, size: ThumbnailSize): Promise<Thumbnail | undefined> {
    const source = this.get(id);
    if (!source) return undefined;
    let data: Buffer;
    try {
      const bytes = Buffer.from(source.dataUrl.slice(source.dataUrl.indexOf(",") + 1), "base64");
      data = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" }).autoOrient()
        .resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    } catch {
      throw new MediaError("Не удалось создать миниатюру: изображение повреждено или превышает 40 мегапикселей", 422);
    }
    const etag = imageEtag(data);
    // Пока Sharp работал, исходник могли удалить. Проверка и вставка — один SQL,
    // а триггер удалит производные и при удалении исходника из другого соединения.
    const inserted = this.db.run(sql`INSERT INTO image_thumbnails (image_id, size, version, data, etag)
      SELECT ${id}, ${size}, ${THUMBNAIL_VERSION}, ${data}, ${etag}
      WHERE EXISTS (SELECT 1 FROM images WHERE id = ${id})
      ON CONFLICT DO NOTHING`);
    return inserted.changes ? { data, etag } : this.cachedThumbnail(id, size);
  }

  listForCampaign(campaignId: string): ImageAttachment[] {
    if (!this.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).get()) {
      throw new MediaError("кампания не найдена", 404);
    }
    return this.db.select({ id: images.id, name: images.name, mimeType: images.mimeType }).from(images)
      .where(eq(images.campaignId, campaignId)).orderBy(asc(images.createdAt), asc(images.id)).all() as ImageAttachment[];
  }

  setCampaignCover(campaignId: string, imageId: string | null): void {
    if (!this.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).get()) {
      throw new MediaError("кампания не найдена", 404);
    }
    if (imageId !== null && !this.db.select({ id: images.id }).from(images)
      .where(and(eq(images.id, imageId), eq(images.campaignId, campaignId))).get()) {
      throw new MediaError("Изображение не найдено в этой кампании");
    }
    this.db.update(campaigns).set({ coverImageId: imageId, updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, campaignId)).run();
  }

  getForCampaign(campaignId: string, ids: string[]): ImageAttachment[] {
    const parsed = ImageIdsSchema.safeParse(ids);
    if (!parsed.success) throw new MediaError("Можно прикрепить до четырёх изображений");
    return [...new Set(parsed.data)].map((id) => {
      const row = this.getMetadata(id);
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
    const doc = this.db.select({ id: documents.id, campaignId: documents.campaignId, title: documents.title, type: documents.type, fields: documents.fields }).from(documents).where(eq(documents.id, id)).get();
    if (!doc) throw new MediaError("документ не найден", 404);
    return doc;
  }

  listForDocument(docId: string): ImageAttachment[] {
    const doc = this.document(docId);
    return this.db.select({ id: images.id, name: images.name, mimeType: images.mimeType }).from(documentImages).innerJoin(images, eq(images.id, documentImages.imageId))
      .where(and(eq(documentImages.documentId, docId), eq(images.campaignId, doc.campaignId)))
      .orderBy(asc(images.createdAt), asc(images.id)).all() as ImageAttachment[];
  }

  setAvatar(docId: string, imageId: string | null): void {
    const doc = this.document(docId);
    if (imageId !== null && !this.listForDocument(docId).some((image) => image.id === imageId)) {
      throw new MediaError("Выберите изображение из галереи этой карточки");
    }
    const fields = JSON.parse(doc.fields) as Record<string, unknown>;
    if (imageId === null) delete fields.avatarImageId;
    else fields.avatarImageId = imageId;
    this.db.update(documents).set({ fields: JSON.stringify(fields), updatedAt: new Date().toISOString() })
      .where(eq(documents.id, docId)).run();
  }

  attach(docId: string, imageId: string): ImageAttachment[] {
    const doc = this.document(docId);
    this.getForCampaign(doc.campaignId, [imageId]);
    this.db.insert(documentImages).values({ documentId: docId, imageId }).onConflictDoNothing().run();
    repairImageNames(this.db, doc.campaignId, imageId);
    return this.listForDocument(docId);
  }

  detach(docId: string, imageId: string): ImageAttachment[] {
    const doc = this.document(docId);
    this.getForCampaign(doc.campaignId, [imageId]);
    this.db.transaction(() => {
      this.db.delete(documentImages).where(and(eq(documentImages.documentId, docId), eq(documentImages.imageId, imageId))).run();
      if ((JSON.parse(doc.fields) as Record<string, unknown>).avatarImageId === imageId) this.setAvatar(docId, null);
    });
    return this.listForDocument(docId);
  }
}
