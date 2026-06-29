import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { ConversationService } from "./conversations.js";

function svc() { return new ConversationService(createDb(":memory:").db); }

describe("ConversationService", () => {
  it("getOrCreateForCampaign возвращает ту же беседу", () => {
    const s = svc();
    const a = s.getOrCreateForCampaign("c1");
    const b = s.getOrCreateForCampaign("c1");
    expect(a.id).toBe(b.id);
  });

  it("addMessage/listMessages сохраняют порядок", () => {
    const s = svc();
    const { id } = s.getOrCreateForCampaign("c1");
    s.addMessage(id, "user", "привет");
    s.addMessage(id, "assistant", "и тебе");
    const msgs = s.listMessages(id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
