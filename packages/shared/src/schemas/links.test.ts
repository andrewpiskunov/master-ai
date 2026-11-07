import { describe, it, expect } from "vitest";
import { NewLinkSchema, DocumentLinksSchema } from "../index.js";

describe("link contracts", () => {
  it("NewLinkSchema принимает корректную связь", () => {
    const r = NewLinkSchema.safeParse({ campaignId: "c1", fromDocId: "a", toDocId: "b", kind: "появляется в" });
    expect(r.success).toBe(true);
  });

  it("NewLinkSchema требует непустой kind", () => {
    const r = NewLinkSchema.safeParse({ campaignId: "c1", fromDocId: "a", toDocId: "b", kind: "" });
    expect(r.success).toBe(false);
  });

  it("DocumentLinksSchema валидирует группы outgoing/incoming", () => {
    const r = DocumentLinksSchema.safeParse({
      outgoing: [{ linkId: "l1", kind: "связан", document: { id: "b", type: "npc", title: "Барон" } }],
      incoming: [],
    });
    expect(r.success).toBe(true);
  });
});
