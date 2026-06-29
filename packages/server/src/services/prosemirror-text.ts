// Извлекает плоский текст из ProseMirror-документа для индексации в FTS.
// Текстовые узлы внутри одного блока склеиваются, блоки разделяются \n.
type PMNode = { type?: string; text?: string; content?: PMNode[] };

export function proseMirrorToText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const blocks: string[] = [];

  function block(node: PMNode): string {
    let s = "";
    if (typeof node.text === "string") s += node.text;
    for (const child of node.content ?? []) s += block(child);
    return s;
  }

  const root = doc as PMNode;
  for (const node of root.content ?? []) {
    const text = block(node).trim();
    if (text) blocks.push(text);
  }
  return blocks.join("\n");
}
