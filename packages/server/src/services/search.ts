import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SearchHit } from "@master-ai/shared";
import { documents } from "../db/schema.js";
import { proseMirrorToText } from "./prosemirror-text.js";

// Превращает пользовательский запрос в безопасную FTS5 MATCH-строку:
// каждый токен — фразой в кавычках (внутренние кавычки удваиваются), термы через AND.
function toMatchQuery(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

export class SearchService {
  constructor(private db: BetterSQLite3Database) {}

  search(campaignId: string, query: string): SearchHit[] {
    const match = toMatchQuery(query);
    if (!match) return [];
    const rows = this.db.all(
      sql`SELECT doc_id, type, title, snippet(documents_fts, 4, '[', ']', '…', 10) AS snippet
          FROM documents_fts
          WHERE campaign_id = ${campaignId} AND documents_fts MATCH ${match}
          ORDER BY bm25(documents_fts)`,
    ) as { doc_id: string; type: string; title: string; snippet: string }[];
    return rows.map((r) => ({ docId: r.doc_id, type: r.type, title: r.title, snippet: r.snippet }));
  }

  // Полная перестройка индекса из таблицы documents (для документов, созданных до появления FTS).
  reindexAll(): void {
    this.db.run(sql`DELETE FROM documents_fts`);
    const rows = this.db.select().from(documents).all();
    for (const row of rows) {
      const body = proseMirrorToText(JSON.parse(row.contentJson));
      this.db.run(
        sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES (${row.id}, ${row.campaignId}, ${row.type}, ${row.title}, ${body})`,
      );
    }
  }
}
