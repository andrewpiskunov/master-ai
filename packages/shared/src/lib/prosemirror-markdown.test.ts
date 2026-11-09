import { describe, expect, it } from "vitest";
import { docToMarkdown } from "./prosemirror-markdown.js";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("document Markdown for export and AI context", () => {
  it("keeps nested list relationships and the original ordered-list start", () => {
    const content = { type: "doc", content: [{ type: "orderedList", attrs: { start: 3 }, content: [
      { type: "listItem", content: [paragraph("Ловушка: порог 3."), { type: "bulletList", content: [
        { type: "listItem", content: [paragraph("Урон: 2.")] },
      ] }] },
      { type: "listItem", content: [paragraph("После броска.")] },
    ] }] };
    expect(docToMarkdown(content)).toBe("3. Ловушка: порог 3.\n\n   - Урон: 2.\n4. После броска.");
  });

  it("keeps headings and paragraph boundaries inside block quotes", () => {
    const content = { type: "doc", content: [{ type: "blockquote", content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Важно" }] },
      paragraph("Сила 3."),
    ] }] };
    expect(docToMarkdown(content)).toBe("> ### Важно\n>\n> Сила 3.");
  });
});
