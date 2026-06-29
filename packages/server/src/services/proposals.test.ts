import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { ProposalService, textToDoc } from "./proposals.js";
import { DocumentService } from "./documents.js";

function setup() {
  const { db } = createDb(":memory:");
  return { proposals: new ProposalService(db), documents: new DocumentService(db) };
}

describe("ProposalService", () => {
  it("create сохраняет pending-предложение", () => {
    const { proposals } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "Барон", content: "текст" } });
    expect(p.status).toBe("pending");
    expect(proposals.listByCampaign("c1", "pending")).toHaveLength(1);
  });

  it("approve создаёт документ и помечает approved", () => {
    const { proposals, documents } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "Барон", content: "Мрачный аристократ." } });
    const doc = proposals.approve(p.id, documents);
    expect(doc?.title).toBe("Барон");
    expect(doc?.type).toBe("npc");
    expect(proposals.get(p.id)?.status).toBe("approved");
    expect(documents.listByCampaign("c1")).toHaveLength(1);
  });

  it("reject помечает rejected и не создаёт документ", () => {
    const { proposals, documents } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "X", content: "Y" } });
    proposals.reject(p.id);
    expect(proposals.get(p.id)?.status).toBe("rejected");
    expect(documents.listByCampaign("c1")).toHaveLength(0);
  });

  it("textToDoc делает параграфы из строк", () => {
    const doc = textToDoc("первая\nвторая") as { content: unknown[] };
    expect(doc.content).toHaveLength(2);
  });
});
