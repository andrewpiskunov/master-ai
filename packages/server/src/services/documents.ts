import { randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, NewDocument } from "@master-ai/shared";
import { documents, links } from "../db/schema.js";
import { proseMirrorToText } from "./prosemirror-text.js";

type DocumentRow = typeof documents.$inferSelect;

function toDocument(row: DocumentRow): Document {
  return {
    ...row,
    contentJson: JSON.parse(row.contentJson),
    fields: JSON.parse(row.fields),
  };
}

export class DocumentService {
  constructor(private db: BetterSQLite3Database) {}

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
    return rows.map(toDocument);
  }

  get(id: string): Document | undefined {
    const row = this.db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .get();
    return row ? toDocument(row) : undefined;
  }

  update(
    id: string,
    patch: Partial<Pick<Document, "type" | "title" | "status" | "contentJson" | "fields">>,
  ): Document | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updates: Partial<DocumentRow> = { updatedAt: new Date().toISOString() };
    if (patch.type !== undefined) updates.type = patch.type;
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.contentJson !== undefined) updates.contentJson = JSON.stringify(patch.contentJson);
    if (patch.fields !== undefined) updates.fields = JSON.stringify(patch.fields);
    this.db.update(documents).set(updates).where(eq(documents.id, id)).run();
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
      this.db.delete(documents).where(eq(documents.id, id)).run();
    });
    return true;
  }
}
