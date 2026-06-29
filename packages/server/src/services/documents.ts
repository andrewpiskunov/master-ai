import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, NewDocument } from "@master-ai/shared";
import { documents } from "../db/schema.js";

interface DocumentRow {
  id: string;
  campaignId: string;
  type: string;
  title: string;
  status: string | null;
  contentJson: string;
  fields: string;
  createdAt: string;
  updatedAt: string;
}

function toDocument(row: DocumentRow): Document {
  return {
    ...row,
    contentJson: JSON.parse(row.contentJson),
    fields: JSON.parse(row.fields),
  };
}

export class DocumentService {
  constructor(private db: BetterSQLite3Database) {}

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
    return toDocument(row);
  }

  listByCampaign(campaignId: string): Document[] {
    const rows = this.db
      .select()
      .from(documents)
      .where(eq(documents.campaignId, campaignId))
      .all() as DocumentRow[];
    return rows.map(toDocument);
  }

  get(id: string): Document | undefined {
    const row = this.db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .get() as DocumentRow | undefined;
    return row ? toDocument(row) : undefined;
  }

  update(
    id: string,
    patch: Partial<Pick<Document, "title" | "status" | "contentJson" | "fields">>,
  ): Document | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updates: Partial<DocumentRow> = { updatedAt: new Date().toISOString() };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.contentJson !== undefined) updates.contentJson = JSON.stringify(patch.contentJson);
    if (patch.fields !== undefined) updates.fields = JSON.stringify(patch.fields);
    this.db.update(documents).set(updates).where(eq(documents.id, id)).run();
    return this.get(id);
  }
}
