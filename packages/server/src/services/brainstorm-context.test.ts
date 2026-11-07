import { afterEach, describe, expect, it } from "vitest";
import type { CompleteInput } from "@master-ai/shared";
import { createDb } from "../db/client.js";
import { BrainstormService } from "./brainstorm.js";
import { CampaignService } from "./campaigns.js";
import { ConversationService } from "./conversations.js";
import { DocumentService } from "./documents.js";
import { ProposalService, textToDoc } from "./proposals.js";

const opened: ReturnType<typeof createDb>["sqlite"][] = [];
afterEach(() => { for (const sqlite of opened.splice(0)) sqlite.close(); });

function setup() {
  const { db, sqlite } = createDb(":memory:");
  opened.push(sqlite);
  const inputs: CompleteInput[] = [];
  const documents = new DocumentService(db);
  const proposals = new ProposalService(db);
  const conversations = new ConversationService(db);
  const service = new BrainstormService({
    llmFor: () => ({ async *complete(input) { inputs.push(input); yield "Ответ"; } }),
    documents, proposals, conversations, campaigns: new CampaignService(db),
  });
  const create = (title: string, content: string, type = "scene", campaignId = "c1") =>
    documents.create({ campaignId, type, title, contentJson: textToDoc(content) });
  return { service, documents, proposals, conversations, inputs, create };
}

function context(input: CompleteInput) {
  const marker = "\n\nКонтекст кампании (JSON):\n";
  expect(input.system).toContain(marker);
  return JSON.parse(input.system!.split(marker).at(-1)!) as {
    documents: Array<{ id: string; title: string; content: string; contentTruncated: boolean }>;
    pendingProposals: Array<{ id: string; title: string; action: string; content: string }>;
  };
}

describe("workshop campaign context", () => {
  it("sends full texts of every material type, status and additional fields, isolated by campaign", async () => {
    const f = setup();
    for (const type of ["npc", "pc", "location", "scene", "session", "secret", "item", "reference"]) {
      f.create(`Карточка ${type}`, `Содержимое ${type}: Сила 3, Ловкость 2.`, type);
    }
    const npc = f.documents.listByCampaign("c1")[0];
    f.documents.update(npc.id, { status: "alive", fields: { customMechanics: { strength: 271828 } } });
    f.create("Чужая карточка", "FOREIGN_CAMPAIGN_SECRET", "note", "c2");

    await f.service.respond("c1", "Обнови названия навыков во всех материалах");
    const input = f.inputs[0];
    for (const type of ["npc", "pc", "location", "scene", "session", "secret", "item", "reference"]) {
      expect(input.system).toContain(`Содержимое ${type}: Сила 3, Ловкость 2.`);
    }
    expect(input.system).toContain("alive");
    expect(input.system).toContain("customMechanics");
    expect(input.system).toContain("271828");
    expect(input.system).not.toContain("FOREIGN_CAMPAIGN_SECRET");
    expect(input.system).not.toContain("Чужая карточка");
    expect(context(input).documents).toHaveLength(8);
    expect(input.messages.at(-1)?.content).toBe("Обнови названия навыков во всех материалах");
  });

  it("refreshes edited texts and removes deleted materials before the next request", async () => {
    const f = setup();
    const changed = f.create("Маяк", "OLD_LIGHTHOUSE_TEXT");
    const removed = f.create("Пристань", "DELETED_PIER_TEXT");
    await f.service.respond("c1", "Посмотри материалы");
    expect(f.inputs[0].system).toContain("OLD_LIGHTHOUSE_TEXT");

    f.documents.update(changed.id, { contentJson: textToDoc("CURRENT_LIGHTHOUSE_TEXT") });
    f.documents.delete(removed.id);
    await f.service.respond("c1", "Используй мои правки");
    expect(f.inputs[1].system).toContain("CURRENT_LIGHTHOUSE_TEXT");
    expect(f.inputs[1].system).not.toContain("OLD_LIGHTHOUSE_TEXT");
    expect(f.inputs[1].system).not.toContain("DELETED_PIER_TEXT");
    expect(context(f.inputs[1]).documents.map((d) => d.id)).toEqual([changed.id]);
  });

  it("preserves editor headings, line breaks, list markers and link destinations in the supplied text", async () => {
    const f = setup();
    f.documents.create({ campaignId: "c1", type: "reference", title: "Правила", contentJson: {
      type: "doc", content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Характеристики" }] },
        { type: "paragraph", content: [{ type: "text", text: "Сила: 3" }, { type: "hardBreak" }, { type: "text", text: "Ловкость: 2" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [
          { type: "text", text: "Правило", marks: [{ type: "link", attrs: { href: "https://example.com/rule-17" } }] },
        ] }] }] },
      ],
    } });
    await f.service.respond("c1", "Проверь правила");
    const text = context(f.inputs[0]).documents[0].content;
    expect(text).toContain("## Характеристики");
    expect(text).toMatch(/Сила: 3\s*\nЛовкость: 2/);
    expect(text).toContain("- [Правило](https://example.com/rule-17)");
  });

  it("retains unapproved proposal contents separately from current documents after JSON is stripped from chat", async () => {
    const f = setup();
    const conv = f.conversations.getOrCreateForCampaign("c1");
    f.service.finishRespond("c1", conv.id, 'Предлагаю сцену.\n```json\n{"proposals":[{"type":"scene","title":"Старый мост","content":"DRAFT_BRIDGE_TEXT: сложность 4.","action":"create"}]}\n```');
    expect(f.conversations.listMessages(conv.id)[0].content).not.toContain("DRAFT_BRIDGE_TEXT");
    f.proposals.create({ campaignId: "c2", conversationId: "elsewhere", draft: { type: "note", title: "Чужой черновик", content: "FOREIGN_DRAFT_SECRET" } });

    await f.service.respond("c1", "Дополни предложенную сцену");
    expect(f.inputs[0].system).toContain("DRAFT_BRIDGE_TEXT: сложность 4.");
    expect(f.inputs[0].system).not.toContain("FOREIGN_DRAFT_SECRET");
    const data = context(f.inputs[0]);
    expect(data.documents).toEqual([]);
    expect(data.pendingProposals).toMatchObject([{ title: "Старый мост", action: "create" }]);
  });

  it("uses the current accepted document and excludes obsolete approved or rejected draft contents", async () => {
    const f = setup();
    const conv = f.conversations.getOrCreateForCampaign("c1");
    const approved = f.proposals.create({ campaignId: "c1", conversationId: conv.id, draft: { type: "scene", title: "Башня", content: "OLD_APPROVED_DRAFT" } });
    const rejected = f.proposals.create({ campaignId: "c1", conversationId: conv.id, draft: { type: "scene", title: "Руины", content: "REJECTED_DRAFT" } });
    const doc = f.proposals.approve(approved.id, f.documents)!;
    f.proposals.reject(rejected.id);
    f.documents.update(doc.id, { contentJson: textToDoc("CURRENT_ACCEPTED_DOCUMENT") });

    await f.service.respond("c1", "Проверь материалы");
    expect(f.inputs[0].system).toContain("CURRENT_ACCEPTED_DOCUMENT");
    expect(f.inputs[0].system).not.toContain("OLD_APPROVED_DRAFT");
    expect(f.inputs[0].system).not.toContain("REJECTED_DRAFT");
    expect(context(f.inputs[0]).pendingProposals).toEqual([]);
  });

  it("includes materials after the former 120-document cutoff", async () => {
    const f = setup();
    for (let n = 1; n <= 125; n++) f.create(`Сцена ${n}`, `FULL_MATERIAL_${n}_END`);
    await f.service.respond("c1", "Проверь все сцены");
    expect(f.inputs[0].system).toContain("FULL_MATERIAL_125_END");
    expect(context(f.inputs[0]).documents).toHaveLength(125);
  });

  it("preserves the end of long materials while the campaign fits the content budget", async () => {
    const f = setup();
    f.create("Архив", "Текст ".repeat(15000) + "IMPORTANT_FINAL_CLUE");
    await f.service.respond("c1", "Проверь архив");
    expect(f.inputs[0].system).toContain("IMPORTANT_FINAL_CLUE");
    expect(context(f.inputs[0]).documents[0].contentTruncated).toBe(false);
  });

  it("marks oversized sources as incomplete while retaining small materials and every title", async () => {
    const f = setup();
    f.create("Большой архив", "A".repeat(200000));
    f.create("Большая хроника", "B".repeat(200000));
    f.create("Короткая улика", "SMALL_BUT_ESSENTIAL_CLUE");
    await f.service.respond("c1", "Посмотри всю кампанию");
    expect(f.inputs[0].system).toContain("SMALL_BUT_ESSENTIAL_CLUE");
    const sources = context(f.inputs[0]).documents;
    expect(sources).toHaveLength(3);
    expect(sources.filter((d) => d.contentTruncated).map((d) => d.title)).toEqual(["Большой архив", "Большая хроника"]);
    expect(sources.reduce((sum, d) => sum + d.content.length, 0)).toBeLessThanOrEqual(180000);
  });

  it("prioritizes the full text of a named material when the entire campaign is too large", async () => {
    const f = setup();
    f.create("Большой архив", "A".repeat(200000));
    f.create("Ключевая сцена", "B".repeat(100000) + "TARGET_FINAL_CLUE");
    await f.service.respond("c1", "Обнови Ключевая сцена");
    expect(f.inputs[0].system).toContain("TARGET_FINAL_CLUE");
    const target = context(f.inputs[0]).documents.find((d) => d.title === "Ключевая сцена")!;
    expect(target.contentTruncated).toBe(false);
  });
});
