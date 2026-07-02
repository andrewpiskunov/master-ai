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

  it("reject не трогает уже одобренное предложение", () => {
    const { proposals, documents } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "X", content: "Y" } });
    proposals.approve(p.id, documents);
    expect(proposals.reject(p.id)).toBeUndefined();
    expect(proposals.get(p.id)?.status).toBe("approved");
  });

  it("approve повторно не создаёт второй документ", () => {
    const { proposals, documents } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "X", content: "Y" } });
    proposals.approve(p.id, documents);
    expect(proposals.approve(p.id, documents)).toBeUndefined();
    expect(documents.listByCampaign("c1")).toHaveLength(1);
  });

  it("approve create-предложения с существующим названием и типом не плодит дубликат", () => {
    const { proposals, documents } = setup();
    const first = documents.create({ campaignId: "c1", type: "lore", title: "Песнь Хора", contentJson: textToDoc("Оригинал.") });
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "lore", title: "песнь хора", content: "Повтор." } });
    const doc = proposals.approve(p.id, documents);
    expect(doc?.id).toBe(first.id);
    expect(documents.listByCampaign("c1")).toHaveLength(1);
    // содержимое существующего документа не перезаписывается
    expect(JSON.stringify(documents.get(first.id)?.contentJson)).toContain("Оригинал");
    expect(proposals.get(p.id)?.status).toBe("approved");
  });

  it("approve create-предложения с тем же названием, но другим типом создаёт отдельный документ", () => {
    const { proposals, documents } = setup();
    documents.create({ campaignId: "c1", type: "arc", title: "Корона", contentJson: textToDoc("Арка.") });
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "secret", title: "Корона", content: "Секрет." } });
    const doc = proposals.approve(p.id, documents);
    expect(doc?.type).toBe("secret");
    expect(documents.listByCampaign("c1")).toHaveLength(2);
  });

  it("textToDoc делает параграфы из строк", () => {
    const doc = textToDoc("первая\nвторая") as { content: unknown[] };
    expect(doc.content).toHaveLength(2);
  });
});
