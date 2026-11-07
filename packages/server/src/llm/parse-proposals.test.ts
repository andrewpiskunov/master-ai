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

  it("отбрасывает предложение с пустыми title или content", () => {
    const text = '```json\n{"proposals":[{"type":"npc","title":"","content":""}]}\n```';
    expect(parseProposals(text).proposals).toHaveLength(0);
  });

  it("extracts image attachments separately so attaching a portrait does not rewrite the entity", () => {
    const documentId = "969abf0a-92c5-4428-9432-94a41594dc21";
    const parsed = parseProposals('Передаю портрет.\n```json\n' + JSON.stringify({ imageAttachments: [{ documentId, path: "/generated/portrait.png" }] }) + '\n```');
    expect(parsed).toMatchObject({ reply: "Передаю портрет.", proposals: [], imageAttachments: [{ documentId, path: "/generated/portrait.png" }] });
  });

  it("reports malformed image JSON instead of silently presenting it as a completed attachment", () => {
    const parsed = parseProposals('Готово.\n```json\n{"imageAttachments":[broken}\n```');
    expect(parsed.reply).toContain("Не удалось обработать прикрепление изображений");
    expect(parsed.imageAttachments).toEqual([]);
  });

  it("rejects a malformed or oversized image batch while retaining ordinary document proposals", () => {
    for (const imageAttachments of [[{ documentId: "invalid", path: "/generated/portrait.png" }], Array.from({ length: 51 }, () => ({ documentId: "969abf0a-92c5-4428-9432-94a41594dc21", path: "/generated/portrait.png" }))]) {
      const parsed = parseProposals('```json\n' + JSON.stringify({ imageAttachments, proposals: [{ type: "note", title: "План", content: "Сохрани эту заметку." }] }) + '\n```');
      expect(parsed.imageAttachments).toEqual([]);
      expect(parsed.reply).toContain("Не удалось обработать прикрепление изображений");
      expect(parsed.proposals).toMatchObject([{ title: "План" }]);
    }
  });
});
