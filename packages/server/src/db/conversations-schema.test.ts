import { describe, it, expect } from "vitest";
import { createDb } from "./client.js";
import { conversations, proposals } from "./schema.js";

describe("новые таблицы", () => {
  it("conversations и proposals создаются миграцией", () => {
    const { db } = createDb(":memory:");
    db.insert(conversations).values({ id: "k1", campaignId: "c1", createdAt: "x" }).run();
    expect(db.select().from(conversations).all()).toHaveLength(1);
    db.insert(proposals).values({
      id: "p1", campaignId: "c1", conversationId: "k1", type: "npc",
      title: "t", content: "c", fields: "{}", status: "pending", createdAt: "x",
    }).run();
    expect(db.select().from(proposals).all()).toHaveLength(1);
  });
});
