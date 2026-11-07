// Плоский текст из ProseMirror-документа — общий для сниппетов карточек,
// поиска упоминаний и брифов, передаваемых ИИ.
export function pmText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[]; type?: string };
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(pmText).join("") : "";
  // Блочные узлы разделяем переносом строки.
  return n.type && n.type !== "text" ? inner + "\n" : inner;
}
