import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SuggestionMark } from "./SuggestionMark.js";

describe("SuggestionMark", () => {
  it("рендерит текст с маркой как span.ai-suggestion", () => {
    const editor = new Editor({
      extensions: [StarterKit, SuggestionMark],
      content: "<p></p>",
    });
    editor.commands.insertContent({
      type: "text",
      text: "идея",
      marks: [{ type: "suggestion" }],
    });
    expect(editor.getHTML()).toContain("ai-suggestion");
    editor.destroy();
  });
});
