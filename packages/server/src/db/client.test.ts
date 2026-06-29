import { describe, it, expect } from "vitest";
import { createDb } from "./client.js";
import { campaigns } from "./schema.js";

describe("createDb", () => {
  it("создаёт таблицы в in-memory БД", () => {
    const { db } = createDb(":memory:");
    // вставка и чтение проходят — значит таблица существует
    db.insert(campaigns)
      .values({ id: "c1", name: "Test", system: null, description: null, createdAt: "2026-06-29T00:00:00.000Z" })
      .run();
    const rows = db.select().from(campaigns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Test");
  });
});
