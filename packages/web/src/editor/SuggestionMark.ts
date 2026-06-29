import { Mark, mergeAttributes } from "@tiptap/core";

export const SuggestionMark = Mark.create({
  name: "suggestion",

  parseHTML() {
    return [{ tag: "span[data-suggestion]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-suggestion": "true", class: "ai-suggestion" }),
      0,
    ];
  },
});
