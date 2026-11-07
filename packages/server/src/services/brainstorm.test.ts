import { describe, it, expect } from "vitest";
import type { CompleteInput } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import { createDb } from "../db/client.js";
import { FakeProvider } from "../llm/fake.js";
import { ConversationService } from "./conversations.js";
import { ProposalService } from "./proposals.js";
import { DocumentService } from "./documents.js";
import { CampaignService } from "./campaigns.js";
import { BrainstormService } from "./brainstorm.js";

// Провайдер со счётчиком вызовов — чтобы проверить кэш проверки противоречий.
class CountingProvider implements LLMProvider {
  calls = 0;
  constructor(private reply: string) {}
  async *complete(_input: CompleteInput): AsyncIterable<string> {
    this.calls++;
    yield this.reply;
  }
}

function make(reply: string) {
  const { db } = createDb(":memory:");
  return new BrainstormService({
    llmFor: () => new FakeProvider([reply]),
    conversations: new ConversationService(db),
    proposals: new ProposalService(db),
    documents: new DocumentService(db),
    campaigns: new CampaignService(db),
  });
}

describe("BrainstormService", () => {
  it("сохраняет реплику и создаёт предложения из ответа", async () => {
    const llmText = 'Идея!\n\n```json\n{"proposals":[{"type":"npc","title":"Барон","content":"Мрачный."}]}\n```';
    const svc = make(llmText);
    const res = await svc.respond("c1", "придумай злодея");
    expect(res.reply).toContain("Идея!");
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0].title).toBe("Барон");
    expect(res.proposals[0].status).toBe("pending");
    expect(res.conversationId).toMatch(/.+/);
  });

  it("проверка противоречий кэшируется, пока документы не менялись", async () => {
    const { db } = createDb(":memory:");
    const docs = new DocumentService(db);
    const llm = new CountingProvider('{"issues":[{"documents":["«A»","«B»"],"contradiction":"тест","fix":"тест"}]}');
    const svc = new BrainstormService({
      llmFor: () => llm, conversations: new ConversationService(db), proposals: new ProposalService(db), documents: docs, campaigns: new CampaignService(db),
    });
    docs.create({ campaignId: "c1", type: "npc", title: "A" });
    docs.create({ campaignId: "c1", type: "npc", title: "B" });

    const r1 = await svc.checkConsistency("c1");
    const r2 = await svc.checkConsistency("c1");
    expect(r1.issues).toHaveLength(1);
    expect(r2.issues).toEqual(r1.issues);
    expect(llm.calls).toBe(1); // второй раз — из кэша, без запроса к ИИ

    // Изменение документа сбрасывает кэш.
    const b = docs.listByCampaign("c1").find((d) => d.title === "B")!;
    docs.update(b.id, { title: "B2" });
    await svc.checkConsistency("c1");
    expect(llm.calls).toBe(2);
  });

  it("sessionSummary разбирает блоки ИТОГИ и ЗАДЕЛ", async () => {
    const { db } = createDb(":memory:");
    const docs = new DocumentService(db);
    const svc = new BrainstormService({
      llmFor: () => new FakeProvider(["ИТОГИ: Партия победила утопленников.\nЗАДЕЛ:\n- Хор вернётся.\n- Мэрла пропала."]),
      conversations: new ConversationService(db), proposals: new ProposalService(db), documents: docs, campaigns: new CampaignService(db),
    });
    const s = docs.create({ campaignId: "c1", type: "session", title: "Сессия 1", fields: { sessionLog: "Был бой." } });
    const res = await svc.sessionSummary(s.id);
    expect(res.summary).toContain("Партия победила");
    expect(res.summary).not.toMatch(/ИТОГИ/i);
    expect(res.seed).toContain("Хор вернётся");
  });

  it("sessionSummary: лог из игрового чата приоритетнее fields.sessionLog; без чата — fallback", async () => {
    const { db } = createDb(":memory:");
    const docs = new DocumentService(db);
    const conv = new ConversationService(db);
    const inputs: string[] = [];
    const llm = {
      async *complete(input: { messages: { content: string }[] }) {
        inputs.push(input.messages[0].content);
        yield "ИТОГИ: Всё случилось.\nЗАДЕЛ:\n- Нить.";
      },
    };
    const svc = new BrainstormService({
      llmFor: () => llm as unknown as LLMProvider,
      conversations: conv, proposals: new ProposalService(db), documents: docs, campaigns: new CampaignService(db),
    });

    const s = docs.create({ campaignId: "c1", type: "session", title: "Сессия 1", fields: { sessionLog: "старый ручной лог" } });
    const cv = conv.getOrCreateForDocument("c1", s.id);
    conv.addMessage(cv.id, "user", "взламывает замок", { actorName: "Алдар", actorKind: "pc" });
    conv.addMessage(cv.id, "assistant", "Замок щёлкает.", { log: { title: "Алдар взломал замок", important: true } });
    await svc.sessionSummary(s.id);
    expect(inputs[0]).toContain("[важно] Алдар взломал замок");
    expect(inputs[0]).toContain("взламывает замок"); // хвост чата тоже уходит в сводку
    expect(inputs[0]).not.toContain("старый ручной лог");

    const s2 = docs.create({ campaignId: "c1", type: "session", title: "Сессия 2", fields: { sessionLog: "старый ручной лог" } });
    await svc.sessionSummary(s2.id);
    expect(inputs[1]).toContain("старый ручной лог");
  });
});
