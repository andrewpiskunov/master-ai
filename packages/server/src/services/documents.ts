import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, ImageAttachment, NewDocument } from "@master-ai/shared";
import { documentImages, documents, images, links } from "../db/schema.js";
import { proseMirrorToText } from "./prosemirror-text.js";

type DocumentRow = typeof documents.$inferSelect;

export class DocumentConflictError extends Error {
  constructor() { super("Документ изменён. Откройте сравнение заново."); }
}

// updatedAt служит версией для условного сохранения, включая несколько правок
// за одну миллисекунду и перевод системных часов назад.
export function nextDocumentUpdatedAt(previous: string): string {
  const previousTime = Date.parse(previous);
  const now = Date.now();
  return new Date(Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now).toISOString();
}

function toDocument(row: DocumentRow): Document {
  return {
    ...row,
    contentJson: JSON.parse(row.contentJson),
    fields: JSON.parse(row.fields),
    avatar: null,
  };
}

export class DocumentService {
  constructor(private db: BetterSQLite3Database) {}

  // Read only metadata in one query for the whole list. Avatar pointers in freeform
  // fields are trusted only when the image belongs to this document's gallery/campaign.
  private withAvatars(rows: DocumentRow[]): Document[] {
    if (!rows.length) return [];
    const gallery = this.db.select({ documentId: documentImages.documentId, id: images.id, name: images.name, mimeType: images.mimeType })
      .from(documentImages).innerJoin(documents, eq(documents.id, documentImages.documentId))
      .innerJoin(images, and(eq(images.id, documentImages.imageId), eq(images.campaignId, documents.campaignId)))
      .where(inArray(documentImages.documentId, rows.map((row) => row.id)))
      .orderBy(asc(images.createdAt), asc(images.id)).all();
    const byDocument = new Map<string, ImageAttachment[]>();
    for (const { documentId, ...image } of gallery) {
      const attached = byDocument.get(documentId) ?? [];
      attached.push(image as ImageAttachment);
      byDocument.set(documentId, attached);
    }
    return rows.map((row) => {
      const doc = toDocument(row);
      const attached = byDocument.get(doc.id) ?? [];
      doc.avatar = attached.find((image) => image.id === doc.fields.avatarImageId) ?? attached[0] ?? null;
      return doc;
    });
  }

  private indexFts(row: { id: string; campaignId: string; type: string; title: string; contentJson: string }): void {
    const body = proseMirrorToText(JSON.parse(row.contentJson));
    this.db.run(sql`DELETE FROM documents_fts WHERE doc_id = ${row.id}`);
    this.db.run(
      sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES (${row.id}, ${row.campaignId}, ${row.type}, ${row.title}, ${body})`,
    );
  }

  create(input: NewDocument): Document {
    const now = new Date().toISOString();
    const row: DocumentRow = {
      id: randomUUID(),
      campaignId: input.campaignId,
      type: input.type,
      title: input.title,
      status: input.status ?? null,
      contentJson: JSON.stringify(input.contentJson ?? null),
      fields: JSON.stringify(input.fields ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(documents).values(row).run();
    this.indexFts(row);
    return toDocument(row);
  }

  listByCampaign(campaignId: string): Document[] {
    const rows = this.db
      .select()
      .from(documents)
      .where(eq(documents.campaignId, campaignId))
      .all();
    return this.withAvatars(rows);
  }

  get(id: string): Document | undefined {
    const row = this.db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .get();
    return row ? this.withAvatars([row])[0] : undefined;
  }

  update(
    id: string,
    patch: Partial<Pick<Document, "type" | "title" | "status" | "contentJson" | "fields">>,
    expectedUpdatedAt?: string,
  ): Document | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    if (expectedUpdatedAt !== undefined && existing.updatedAt !== expectedUpdatedAt) throw new DocumentConflictError();
    // The dedicated avatar endpoint owns this field. Older whole-fields saves
    // from tags, sessions or AI edits must not erase a newer image selection.
    let patchedFields = patch.fields;
    if (patchedFields !== undefined) {
      patchedFields = { ...patchedFields };
      delete patchedFields.avatarImageId;
      if (typeof existing.fields.avatarImageId === "string") patchedFields.avatarImageId = existing.fields.avatarImageId;
    }
    const updates: Partial<DocumentRow> = { updatedAt: nextDocumentUpdatedAt(existing.updatedAt) };
    if (patch.type !== undefined) updates.type = patch.type;
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.contentJson !== undefined) {
      updates.contentJson = JSON.stringify(patch.contentJson);
      // Отметка времени изменения именно контента (fields.contentUpdatedAt) — по ней
      // помощник «старит» свои предложения; правки статусов/тегов её не трогают.
      const contentChanged = updates.contentJson !== JSON.stringify(existing.contentJson);
      const baseFields = patchedFields ?? existing.fields;
      updates.fields = JSON.stringify(contentChanged ? { ...baseFields, contentUpdatedAt: updates.updatedAt } : baseFields);
    } else if (patchedFields !== undefined) {
      updates.fields = JSON.stringify(patchedFields);
    }
    const result = this.db.update(documents).set(updates).where(expectedUpdatedAt === undefined
      ? eq(documents.id, id)
      : and(eq(documents.id, id), eq(documents.updatedAt, expectedUpdatedAt))).run();
    if (!result.changes) {
      if (expectedUpdatedAt !== undefined && this.get(id)) throw new DocumentConflictError();
      return undefined;
    }
    const updated = this.get(id);
    if (updated) {
      this.indexFts({
        id: updated.id,
        campaignId: updated.campaignId,
        type: updated.type,
        title: updated.title,
        contentJson: JSON.stringify(updated.contentJson),
      });
    }
    return updated;
  }

  // Удаляет документ вместе с его связями, беседой ассистента и записью в полнотекстовом индексе.
  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.db.transaction(() => {
      this.db.run(sql`DELETE FROM documents_fts WHERE doc_id = ${id}`);
      this.db.delete(links).where(or(eq(links.fromDocId, id), eq(links.toDocId, id))).run();
      this.db.run(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE document_id = ${id})`);
      this.db.run(sql`DELETE FROM conversations WHERE document_id = ${id}`);
      this.db.delete(documentImages).where(eq(documentImages.documentId, id)).run();
      this.db.delete(documents).where(eq(documents.id, id)).run();
    });
    return true;
  }
}
