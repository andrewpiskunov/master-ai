import { describe, it, expect } from "vitest";
import { ProposalSchema, DraftProposalSchema } from "./proposal.js";

describe("proposal schemas", () => {
  it("ProposalSchema принимает валидное предложение", () => {
    const v = {
      id: "p1", campaignId: "c1", conversationId: "k1",
      type: "npc", title: "Барон", content: "Мрачный аристократ.",
      fields: {}, status: "pending", createdAt: "2026-06-29T00:00:00.000Z",
    };
    expect(ProposalSchema.parse(v)).toEqual(v);
  });

  it("DraftProposalSchema требует type/title/content", () => {
    const d = DraftProposalSchema.parse({ type: "npc", title: "X", content: "Y" });
    expect(d.title).toBe("X");
  });

  it("ProposalSchema отвергает неизвестный статус", () => {
    expect(() =>
      ProposalSchema.parse({ id: "p", campaignId: "c", conversationId: "k", type: "npc", title: "t", content: "c", fields: {}, status: "maybe", createdAt: "x" }),
    ).toThrow();
  });
});
