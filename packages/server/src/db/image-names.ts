import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ImageAttachment } from "@master-ai/shared";
import { conversations, documentImages, documents, images, messages } from "./schema.js";

const extensions = ["png", "jpg", "jpeg", "webp"];
const placeholders = ["illustration", "portrait", "npc", "image", "generated"].flatMap((stem) => extensions.map((ext) => `${stem}.${ext}`));
const uuidGlob = `${"[0-9a-f]".repeat(8)}-${"[0-9a-f]".repeat(4)}-${"[0-9a-f]".repeat(4)}-${"[0-9a-f]".repeat(4)}-${"[0-9a-f]".repeat(12)}.*`;

function technicalName(name: string): boolean {
  return placeholders.includes(name.toLowerCase()) || /^(?:exec[-_])?(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:png|jpe?g|webp)$/i.test(name);
}

export function generatedImageName(title: string, type: string, mimeType: ImageAttachment["mimeType"]): string {
  const clean = title.normalize("NFC").replace(/[\\/<>:"|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "") || "Без названия";
  const suffix = ` — ${type === "npc" || type === "pc" ? "портрет" : "иллюстрация"}.${mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png"}`;
  // Keep the schema's UTF-16 length limit without cutting an emoji in half.
  let stem = "";
  for (const char of clean) {
    if (stem.length + char.length > 200 - suffix.length) break;
    stem += char;
  }
  return `${stem.trimEnd()}${suffix}`;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function renamedMeta(raw: string, names: Map<string, string>): string | undefined {
  let meta: unknown;
  try { meta = JSON.parse(raw); } catch { return; }
  if (!record(meta)) return;
  let changed = false;
  const rename = (value: unknown): void => {
    if (!record(value) || typeof value.id !== "string") return;
    const name = names.get(value.id);
    if (name !== undefined && value.name !== name) { value.name = name; changed = true; }
  };
  if (Array.isArray(meta.images)) for (const image of meta.images) rename(image);
  if (Array.isArray(meta.imageAttachments)) {
    for (const result of meta.imageAttachments) if (record(result)) rename(result.image);
  }
  return changed ? JSON.stringify(meta) : undefined;
}

// Small idempotent data repair: exact technical placeholders only, metadata only.
// Old databases need no schema change; a second open performs no writes.
export function repairImageNames(db: BetterSQLite3Database, campaignId?: string, imageId?: string): void {
  const candidates = db.select({ id: images.id, campaignId: images.campaignId, name: images.name, mimeType: images.mimeType })
    .from(images).where(and(
      campaignId === undefined ? undefined : eq(images.campaignId, campaignId),
      imageId === undefined ? undefined : eq(images.id, imageId),
      or(inArray(sql`lower(${images.name})`, placeholders), sql`lower(${images.name}) GLOB 'exec-*.*'`, sql`lower(${images.name}) GLOB 'exec_*.*'`,
        sql`lower(${images.name}) GLOB ${uuidGlob}`, sql`lower(${images.name}) GLOB ${"[0-9a-f]".repeat(32) + ".*"}`),
    )).all().filter((image) => technicalName(image.name));
  if (!candidates.length) return;
  db.transaction(() => {
    const gallery = db.select({ imageId: images.id, title: documents.title, type: documents.type })
      .from(documentImages).innerJoin(images, eq(images.id, documentImages.imageId))
      .innerJoin(documents, and(eq(documents.id, documentImages.documentId), eq(documents.campaignId, images.campaignId)))
      .where(inArray(images.id, candidates.map((image) => image.id))).orderBy(asc(documents.createdAt), asc(documents.id)).all();
    const namesByCampaign = new Map<string, Map<string, string>>();
    for (const image of candidates) {
      const doc = gallery.find((item) => item.imageId === image.id);
      if (!doc) continue;
      const name = generatedImageName(doc.title, doc.type, image.mimeType as ImageAttachment["mimeType"]);
      db.update(images).set({ name }).where(eq(images.id, image.id)).run();
      const names = namesByCampaign.get(image.campaignId) ?? new Map<string, string>();
      names.set(image.id, name); namesByCampaign.set(image.campaignId, names);
    }
    if (!namesByCampaign.size) return;
    const history = db.select({ id: messages.id, meta: messages.meta, campaignId: conversations.campaignId }).from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(inArray(conversations.campaignId, [...namesByCampaign.keys()])).all();
    for (const row of history) {
      const meta = renamedMeta(row.meta, namesByCampaign.get(row.campaignId)!);
      if (meta !== undefined) db.update(messages).set({ meta }).where(eq(messages.id, row.id)).run();
    }
  });
}
