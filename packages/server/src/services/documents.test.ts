import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";

function makeService() {
  const { db } = createDb(":memory:");
  return new DocumentService(db);
}

describe("DocumentService", () => {
  it("create сохраняет и возвращает документ с распарсенными полями", () => {
    const svc = makeService();
    const doc = svc.create({
      campaignId: "c1",
      type: "npc",
      title: "Барон",
      contentJson: { type: "doc", content: [] },
      fields: { faction: "Совет" },
    });
    expect(doc.id).toMatch(/.+/);
    expect(doc.contentJson).toEqual({ type: "doc", content: [] });
    expect(doc.fields).toEqual({ faction: "Совет" });
    expect(doc.status).toBeNull();
  });

  it("listByCampaign фильтрует по кампании", () => {
    const svc = makeService();
    svc.create({ campaignId: "c1", type: "npc", title: "A" });
    svc.create({ campaignId: "c2", type: "npc", title: "B" });
    const list = svc.listByCampaign("c1");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("A");
  });

  it("update меняет поля и обновляет updatedAt", () => {
    const svc = makeService();
    const doc = svc.create({ campaignId: "c1", type: "npc", title: "A" });
    const updated = svc.update(doc.id, { title: "B", fields: { x: 1 } });
    expect(updated?.title).toBe("B");
    expect(updated?.fields).toEqual({ x: 1 });
  });

  it("get возвращает undefined для несуществующего id", () => {
    const svc = makeService();
    expect(svc.get("nope")).toBeUndefined();
  });
});
