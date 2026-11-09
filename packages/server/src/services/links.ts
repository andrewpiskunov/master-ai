import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Link, NewLink, DocumentLinks, LinkedDocument } from "@master-ai/shared";
import { links, documents } from "../db/schema.js";

export class LinkService {
  constructor(private db: BetterSQLite3Database) {}

  listByCampaign(campaignId: string): Link[] {
    const ids = new Set(this.db.select({ id: documents.id }).from(documents).where(eq(documents.campaignId, campaignId)).all().map((d) => d.id));
    return this.db.select().from(links).where(eq(links.campaignId, campaignId)).all()
      .filter((link) => ids.has(link.fromDocId) && ids.has(link.toDocId));
  }

  create(input: NewLink): Link {
    const row = { id: randomUUID(), ...input };
    this.db.insert(links).values(row).run();
    return row;
  }

  listForDocument(docId: string): DocumentLinks {
    const rows = this.db.select().from(links).all();
    const outgoingRows = rows.filter((l) => l.fromDocId === docId);
    const incomingRows = rows.filter((l) => l.toDocId === docId);

    const otherIds = [
      ...outgoingRows.map((l) => l.toDocId),
      ...incomingRows.map((l) => l.fromDocId),
    ];
    const docs = otherIds.length
      ? this.db.select().from(documents).where(inArray(documents.id, otherIds)).all()
      : [];
    const byId = new Map(docs.map((d) => [d.id, d]));

    const view = (linkId: string, kind: string, otherId: string): LinkedDocument | null => {
      const d = byId.get(otherId);
      if (!d) return null;
      return { linkId, kind, document: { id: d.id, type: d.type, title: d.title } };
    };

    return {
      outgoing: outgoingRows
        .map((l) => view(l.id, l.kind, l.toDocId))
        .filter((x): x is LinkedDocument => x !== null),
      incoming: incomingRows
        .map((l) => view(l.id, l.kind, l.fromDocId))
        .filter((x): x is LinkedDocument => x !== null),
    };
  }

  delete(id: string): boolean {
    const res = this.db.delete(links).where(eq(links.id, id)).run();
    return res.changes > 0;
  }
}
