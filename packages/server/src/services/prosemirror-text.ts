// Извлекает плоский текст из ProseMirror-документа для индексации в FTS.
// Текстовые узлы внутри одного блока склеиваются; блоки (включая пункты
// списков) разделяются \n — иначе слова на стыке пунктов слипаются и не ищутся.
type PMNode = { type?: string; text?: string; content?: PMNode[] };

// Узлы-контейнеры блоков: их детей соединяем переводами строк.
const CONTAINERS = new Set(["doc", "bulletList", "orderedList", "listItem", "blockquote"]);

export function proseMirrorToText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";

  function textOf(node: PMNode): string {
    if (typeof node.text === "string") return node.text;
    const parts = (node.content ?? []).map(textOf);
    return CONTAINERS.has(node.type ?? "")
      ? parts.map((p) => p.trim()).filter(Boolean).join("\n")
      : parts.join("");
  }

  return textOf(doc as PMNode);
}
