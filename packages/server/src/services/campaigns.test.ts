import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "../db/client.js";
import { CampaignService } from "./campaigns.js";

function makeService() {
  const { db } = createDb(":memory:");
  return new CampaignService(db);
}

describe("CampaignService", () => {
  it("create возвращает кампанию с id и createdAt", () => {
    const svc = makeService();
    const c = svc.create({ name: "Город Солнца" });
    expect(c.id).toMatch(/.+/);
    expect(c.name).toBe("Город Солнца");
    expect(c.system).toBeNull();
    expect(c.createdAt).toMatch(/^\d{4}-/);
  });

  it("list возвращает созданные кампании", () => {
    const svc = makeService();
    svc.create({ name: "A" });
    svc.create({ name: "B" });
    expect(svc.list()).toHaveLength(2);
  });

  it("get возвращает кампанию по id или undefined", () => {
    const svc = makeService();
    const c = svc.create({ name: "A" });
    expect(svc.get(c.id)?.name).toBe("A");
    expect(svc.get("nope")).toBeUndefined();
  });
});
