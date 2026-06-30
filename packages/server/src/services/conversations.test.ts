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

  it("getOrCreateForDocument возвращает ту же беседу для документа", () => {
    const s = svc();
    const a = s.getOrCreateForDocument("c1", "d1");
    const b = s.getOrCreateForDocument("c1", "d1");
    expect(a.id).toBe(b.id);
  });

  it("беседа документа отделена от беседы Мастерской и от других документов", () => {
    const s = svc();
    const camp = s.getOrCreateForCampaign("c1");
    const d1 = s.getOrCreateForDocument("c1", "d1");
    const d2 = s.getOrCreateForDocument("c1", "d2");
    expect(new Set([camp.id, d1.id, d2.id]).size).toBe(3);
    // повторный вызов на уровне кампании не подхватывает беседу документа
    expect(s.getOrCreateForCampaign("c1").id).toBe(camp.id);
  });
});
