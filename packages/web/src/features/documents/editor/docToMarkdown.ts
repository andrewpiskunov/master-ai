// Сериализация ProseMirror-JSON в Markdown — для экспорта кампании.
// Покрывает узлы и марки, которые реально используются в редакторе
// (StarterKit + Underline/Link). Подчёркивание в markdown не выражается — оставляем текст.

interface PMNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: PMNode[];
}

function inline(node: PMNode): string {
  if (node.type === "text") {
    let t = node.text ?? "";
    for (const m of node.marks ?? []) {
      if (m.type === "bold") t = `**${t}**`;
      else if (m.type === "italic") t = `*${t}*`;
      else if (m.type === "code") t = `\`${t}\``;
      else if (m.type === "strike") t = `~~${t}~~`;
      else if (m.type === "link") t = `[${t}](${String(m.attrs?.href ?? "")})`;
    }
    return t;
  }
  if (node.type === "hardBreak") return "  \n";
  return (node.content ?? []).map(inline).join("");
}

function listItemText(item: PMNode): string {
  // Пункт списка обычно содержит один параграф; берём его inline-текст.
  return (item.content ?? []).map(inline).join(" ").trim();
}

function block(node: PMNode, headingOffset: number): string {
  switch (node.type) {
    case "heading": {
      const level = Math.min(6, Number(node.attrs?.level ?? 1) + headingOffset);
      return `${"#".repeat(level)} ${inline(node)}`;
    }
    case "paragraph":
      return inline(node);
    case "blockquote":
      return (node.content ?? []).map((c) => `> ${inline(c)}`).join("\n");
    case "codeBlock":
      return `\`\`\`\n${inline(node)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "bulletList":
      return (node.content ?? []).map((li) => `- ${listItemText(li)}`).join("\n");
    case "orderedList":
      return (node.content ?? []).map((li, i) => `${i + 1}. ${listItemText(li)}`).join("\n");
    default:
      return inline(node);
  }
}

// headingOffset смещает уровни заголовков документа (для экспорта под «### Название»).
export function docToMarkdown(content: unknown, headingOffset = 0): string {
  const doc = content as PMNode | null;
  if (!doc || !Array.isArray(doc.content)) return "";
  return doc.content.map((n) => block(n, headingOffset)).filter((s) => s.length > 0).join("\n\n");
}
