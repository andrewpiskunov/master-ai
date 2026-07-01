import { generateHTML } from "@tiptap/core";
import { baseExtensions } from "./extensions.js";

// ProseMirror-JSON → HTML тем же набором расширений, что и редактор, чтобы
// разметка совпадала в печати, режиме игры и экспорте.
export function contentToHtml(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  try {
    return generateHTML(content as Record<string, unknown>, baseExtensions);
  } catch {
    return "";
  }
}
