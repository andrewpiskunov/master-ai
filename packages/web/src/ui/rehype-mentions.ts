import { matchMentions, prepareMentions, type MentionItem } from "../mentions.js";

// Узел дерева hast (после markdown → HTML). Описываем только нужные поля.
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

// Внутри этих элементов подсветку не делаем (код, ссылки).
const SKIP_TAGS = new Set(["code", "pre", "a"]);

// rehype-плагин: оборачивает вхождения названий сущностей в <span class="mention …">.
export function rehypeMentions(mentions: MentionItem[]) {
  const prepared = prepareMentions(mentions);

  function splitText(value: string): HastNode[] {
    const spans = matchMentions(value, prepared);
    if (!spans.length) return [{ type: "text", value }];
    const out: HastNode[] = [];
    let cursor = 0;
    for (const s of spans) {
      if (s.start > cursor) out.push({ type: "text", value: value.slice(cursor, s.start) });
      out.push({
        type: "element",
        tagName: "span",
        properties: { className: ["mention", `mention-${s.type}`] },
        children: [{ type: "text", value: value.slice(s.start, s.end) }],
      });
      cursor = s.end;
    }
    if (cursor < value.length) out.push({ type: "text", value: value.slice(cursor) });
    return out;
  }

  function walk(node: HastNode) {
    if (!node.children) return;
    if (node.tagName && SKIP_TAGS.has(node.tagName)) return;
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        next.push(...splitText(child.value));
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  }

  // unified-attacher: возвращает трансформер дерева.
  return function attacher() {
    return function transform(tree: unknown) {
      if (prepared.length) walk(tree as HastNode);
    };
  };
}
