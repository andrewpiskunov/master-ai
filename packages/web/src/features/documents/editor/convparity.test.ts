import { describe, it, expect } from "vitest";
import { markdownToDoc } from "./DocumentEditor.js";
import { pmText } from "../../../lib/prosemirror-text.js";

// Паритет с серверным конвертером textToDoc: тот же образец markdown должен давать
// тот же нормализованный текст. Зеркальный тест — packages/server/src/services/proposals.test.ts;
// при изменении образца или ожидания правьте оба.
describe("паритет markdown-конвертеров (веб-сторона)", () => {
  it("markdownToDoc + pmText даёт тот же извлечённый текст, что textToDoc на сервере", () => {
    const md = "## Заголовок\nАбзац с **жирным** и *курсивом*.\n- первый пункт\n- второй пункт\n1. раз\n2. два";
    const normalized = pmText(markdownToDoc(md)).replace(/\n+/g, "\n").trim();
    expect(normalized).toBe("Заголовок\nАбзац с жирным и курсивом.\nпервый пункт\nвторой пункт\nраз\nдва");
  });
});
