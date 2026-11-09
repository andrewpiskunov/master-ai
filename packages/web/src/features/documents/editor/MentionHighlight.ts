import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { matchMentions, prepareMentions, type MentionItem } from "../../../lib/mentions.js";

export type { MentionItem };

export const mentionKey = new PluginKey("mentionHighlight");

const OPEN_HINT = "Cmd/Ctrl+клик — открыть карточку";
const LINK_HINT = "Cmd/Ctrl+клик — открыть в новой вкладке; ПКМ — открыть в новой вкладке или новом окне";

function openMentionLink(event: MouseEvent): boolean {
  const href = (event.target as HTMLElement | null)?.closest?.("a.mention[href]")?.getAttribute("href");
  if (!href) return false;
  // Chrome не активирует ссылки внутри contenteditable сам, даже со средней кнопкой.
  event.preventDefault();
  window.open(href, "_blank", event.shiftKey ? "noopener,popup" : "noopener");
  return true;
}

// Подсвечивает в тексте упоминания других сущностей кампании цветом их типа.
function buildDecorations(doc: PMNode, mentions: MentionItem[]): DecorationSet {
  const prepared = prepareMentions(mentions);
  if (!prepared.length) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const s of matchMentions(node.text, prepared)) {
      const href = node.marks.some((mark) => mark.type.name === "link") ? undefined : s.href;
      decos.push(Decoration.inline(pos + s.start, pos + s.end, {
        ...(href ? { nodeName: "a", href } : {}),
        class: `mention mention-${s.type}`,
        title: href ? LINK_HINT : OPEN_HINT,
        "data-mention": node.text.slice(s.start, s.end),
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export interface MentionHighlightOptions {
  // Запасной обработчик Cmd/Ctrl+клика для упоминаний без href.
  onOpen: ((title: string) => void) | null;
}

export const MentionHighlight = Extension.create<MentionHighlightOptions>({
  name: "mentionHighlight",
  addOptions() {
    return { onOpen: null };
  },
  addProseMirrorPlugins() {
    const getOnOpen = () => this.options.onOpen;
    return [
      new Plugin({
        key: mentionKey,
        state: {
          init: () => ({ mentions: [] as MentionItem[], decos: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(mentionKey) as { mentions: MentionItem[] } | undefined;
            if (meta) return { mentions: meta.mentions, decos: buildDecorations(newState.doc, meta.mentions) };
            if (tr.docChanged) return { mentions: value.mentions, decos: buildDecorations(newState.doc, value.mentions) };
            return value;
          },
        },
        props: {
          decorations(state) {
            return mentionKey.getState(state)?.decos;
          },
          handleDOMEvents: {
            click(_view, event) {
              if (event.button !== 0 || event.altKey) return false;
              if (event.metaKey || event.ctrlKey || event.shiftKey) return openMentionLink(event);
              const link = (event.target as HTMLElement | null)?.closest?.("a.mention[href]");
              if (!link) return false;
              // Курсор уже поставлен на mousedown; обычный клик не уводит из редактора.
              event.preventDefault();
              return true;
            },
            auxclick(_view, event) {
              return event.button === 1 ? openMentionLink(event) : false;
            },
          },
          handleClick(_view, _pos, event) {
            if (!event.metaKey && !event.ctrlKey) return false;
            const el = (event.target as HTMLElement | null)?.closest?.(".mention[data-mention]");
            if (el?.closest("a[href]")) return false;
            const title = el?.getAttribute("data-mention");
            const onOpen = getOnOpen();
            if (title && onOpen) {
              onOpen(title);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
