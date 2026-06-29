import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client.js";

describe("миграция links + FTS5", () => {
  it("создаёт таблицу links и виртуальную documents_fts", () => {
    const { db } = createDb(":memory:");
    const tables = db.all(
      sql`SELECT name FROM sqlite_master WHERE type IN ('table') AND name IN ('links','documents_fts')`,
    ) as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain("links");
    expect(names).toContain("documents_fts");
  });

  it("FTS5 матчит вставленную строку с кириллицей", () => {
    const { db } = createDb(":memory:");
    db.run(sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES ('d1','c1','npc','Барон','Мрачный аристократ из замка')`);
    const rows = db.all(
      sql`SELECT doc_id FROM documents_fts WHERE documents_fts MATCH ${'"аристократ"'}`,
    ) as { doc_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].doc_id).toBe("d1");
  });
});
