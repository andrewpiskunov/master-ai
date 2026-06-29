import { describe, it, expect } from "vitest";
import { DocumentSchema, NewDocumentSchema } from "./document.js";

describe("DocumentSchema", () => {
  it("принимает валидный документ", () => {
    const value = {
      id: "d1",
      campaignId: "c1",
      type: "npc",
      title: "Барон фон Кройц",
      status: "alive",
      contentJson: { type: "doc", content: [] },
      fields: { faction: "Совет" },
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    };
    expect(DocumentSchema.parse(value)).toEqual(value);
  });

  it("NewDocumentSchema требует campaignId, type, title", () => {
    const parsed = NewDocumentSchema.parse({
      campaignId: "c1",
      type: "npc",
      title: "X",
    });
    expect(parsed.title).toBe("X");
  });
});
