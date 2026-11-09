import { describe, expect, it } from "vitest";
import { parseAssistant } from "./assistant-blocks.js";

describe("assistant image action presentation", () => {
  it("preserves explicit document IDs in edit proposals while accepting legacy title-only blocks", () => {
    const parsed = parseAssistant('```edit-doc\nid: npc-1\ntitle: Проводник\nrename: Иван Проводник\n---\nНовое описание\n```');
    expect(parsed.edits).toEqual([{ documentId: "npc-1", title: "Проводник", rename: "Иван Проводник", text: "Новое описание" }]);
    expect(parseAssistant('```edit-doc\ntitle: Проводник\n---\nНовое описание\n```').edits[0].title).toBe("Проводник");
  });
  it("hides completed image controls without hiding ordinary JSON or document edits", () => {
    const content = 'Иллюстрация.\n```json\n{"imageAttachments":[{"documentId":"d1","prompt":"Портрет"}]}\n```\n```json\n{"example":true}\n```\n```doc\nНовый текст\n```';
    const result = parseAssistant(content);
    expect(result.intro).not.toContain("imageAttachments");
    expect(result.intro).toContain('{"example":true}');
    expect(result.doc).toBe("Новый текст");
  });

  it("hides incomplete streaming image controls", () => {
    expect(parseAssistant('Создаю.\n```json\n{"imageAttachments":[{"documentId":').intro).toBe("Создаю.");
  });

  it("accepts compact control fences and hides an incomplete control prefix", () => {
    expect(parseAssistant('Создаю.\n```json {"imageAttachments":[]} ```').intro).toBe("Создаю.");
    expect(parseAssistant('Создаю.\n```json\n{"imageAttach').intro).toBe("Создаю.");
  });
});

describe("edit metadata boundaries", () => {
  it("does not treat id/title/rename lines in replacement text as target metadata", () => {
    const result = parseAssistant('```edit-doc\ntitle: Записка\n---\nid: another-card\nrename: Подмена\ntitle: Текст записки\nОписание\n```');
    expect(result.edits).toEqual([{ title: "Записка", rename: undefined, text: 'id: another-card\nrename: Подмена\ntitle: Текст записки\nОписание' }]);
  });
});
