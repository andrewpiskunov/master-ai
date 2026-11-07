import { describe, it, expect } from "vitest";
import { proseMirrorToText } from "./prosemirror-text.js";

describe("proseMirrorToText", () => {
  it("собирает текст из вложенных узлов", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Барон" }, { type: "text", text: " фон Кройц" }] },
        { type: "paragraph", content: [{ type: "text", text: "Мрачный аристократ." }] },
      ],
    };
    expect(proseMirrorToText(doc)).toBe("Барон фон Кройц\nМрачный аристократ.");
  });

  it("на null / пустом возвращает пустую строку", () => {
    expect(proseMirrorToText(null)).toBe("");
    expect(proseMirrorToText({ type: "doc", content: [] })).toBe("");
  });

  it("пункты списка разделяются переводом строки, а не склеиваются", () => {
    const li = (text: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    const doc = {
      type: "doc",
      content: [
        { type: "bulletList", content: [li("первый пункт"), li("второй пункт")] },
        { type: "orderedList", content: [li("раз"), li("два")] },
      ],
    };
    expect(proseMirrorToText(doc)).toBe("первый пункт\nвторой пункт\nраз\nдва");
  });
});
