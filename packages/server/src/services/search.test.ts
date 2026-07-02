import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";
import { SearchService } from "./search.js";

function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe("SearchService", () => {
  it("находит документ по слову из тела", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("Мрачный аристократ из замка") });
    const hits = search.search("c1", "аристократ");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("Барон");
    expect(hits[0].type).toBe("npc");
  });

  it("находит по заголовку", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "location", title: "Таверна Полумесяц", contentJson: doc("дым и эль") });
    expect(search.search("c1", "Полумесяц")).toHaveLength(1);
  });

  it("находит по началу слова (префиксный поиск)", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "lore", title: "Песнь Хора", contentJson: doc("многоголосое пение из тумана") });
    expect(search.search("c1", "Песн")).toHaveLength(1);
    expect(search.search("c1", "пени")).toHaveLength(1);
    // несколько термов: каждый — по префиксу
    expect(search.search("c1", "песн хор")).toHaveLength(1);
    expect(search.search("c1", "песн замок")).toHaveLength(0);
  });

  it("не находит документы из другой кампании", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("аристократ") });
    expect(search.search("c2", "аристократ")).toHaveLength(0);
  });

  it("update переиндексирует тело", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    const d = documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("старый текст") });
    documents.update(d.id, { contentJson: doc("новое слово фисштибрамс") });
    expect(search.search("c1", "старый")).toHaveLength(0);
    expect(search.search("c1", "фисштибрамс")).toHaveLength(1);
  });

  it("пустой запрос возвращает пусто", () => {
    const { db } = createDb(":memory:");
    const search = new SearchService(db);
    expect(search.search("c1", "   ")).toHaveLength(0);
  });

  it("reindexAll восстанавливает индекс из таблицы documents", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("аристократ") });
    // имитируем потерю индекса
    db.run(sql`DELETE FROM documents_fts`);
    expect(search.search("c1", "аристократ")).toHaveLength(0);
    search.reindexAll();
    expect(search.search("c1", "аристократ")).toHaveLength(1);
  });
});
