import { describe, expect, it } from "vitest";
import { parseAssistant } from "./assistant-blocks.js";

describe("assistant image action presentation", () => {
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
