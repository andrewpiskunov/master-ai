import { describe, it, expect } from "vitest";
import { parseProposals } from "./parse-proposals.js";

describe("parseProposals", () => {
  it("извлекает предложения из json-блока и чистит reply", () => {
    const text = 'Вот идея для NPC.\n\n```json\n{"proposals":[{"type":"npc","title":"Барон","content":"Мрачный."}]}\n```';
    const { reply, proposals } = parseProposals(text);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toBe("Барон");
    expect(reply).toContain("Вот идея для NPC.");
    expect(reply).not.toContain("```");
  });

  it("без блока возвращает текст и пустые proposals", () => {
    const { reply, proposals } = parseProposals("просто ответ");
    expect(proposals).toHaveLength(0);
    expect(reply).toBe("просто ответ");
  });

  it("игнорирует неизвестный тип документа", () => {
    const text = '```json\n{"proposals":[{"type":"чепуха","title":"X","content":"Y"}]}\n```';
    expect(parseProposals(text).proposals).toHaveLength(0);
  });
});
