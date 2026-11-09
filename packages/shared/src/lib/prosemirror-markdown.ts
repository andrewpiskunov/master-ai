// Сериализация ProseMirror-JSON в Markdown — для экспорта и контекста ИИ.
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

function listItemText(item: PMNode, headingOffset: number, prefix: string): string {
  const text = (item.content ?? []).map((child) => block(child, headingOffset)).join("\n\n");
  const indent = " ".repeat(prefix.length);
  return text.split("\n").map((line, i) => `${i === 0 ? prefix : line ? indent : ""}${line}`).join("\n");
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
      return (node.content ?? []).map((c) => block(c, headingOffset)).join("\n\n")
        .split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
    case "codeBlock":
      return `\`\`\`\n${inline(node)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "bulletList":
      return (node.content ?? []).map((li) => listItemText(li, headingOffset, "- ")).join("\n");
    case "orderedList":
      return (node.content ?? []).map((li, i) => listItemText(li, headingOffset, `${Number(node.attrs?.start ?? 1) + i}. `)).join("\n");
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
