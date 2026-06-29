import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { FakeProvider } from "../llm/fake.js";
import { ConversationService } from "./conversations.js";
import { ProposalService } from "./proposals.js";
import { BrainstormService } from "./brainstorm.js";

function make(reply: string) {
  const { db } = createDb(":memory:");
  return new BrainstormService({
    llm: new FakeProvider([reply]),
    conversations: new ConversationService(db),
    proposals: new ProposalService(db),
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
});
