import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { matchMentions, prepareMentions, type MentionItem } from "../../../lib/mentions.js";

export type { MentionItem };

export const mentionKey = new PluginKey("mentionHighlight");

const OPEN_HINT = "Cmd/Ctrl+клик — открыть карточку";

// Подсвечивает в тексте упоминания других сущностей кампании цветом их типа.
function buildDecorations(doc: PMNode, mentions: MentionItem[]): DecorationSet {
  const prepared = prepareMentions(mentions);
  if (!prepared.length) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const s of matchMentions(node.text, prepared)) {
      decos.push(Decoration.inline(pos + s.start, pos + s.end, {
        class: `mention mention-${s.type}`,
        title: OPEN_HINT,
        "data-mention": node.text.slice(s.start, s.end),
      }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export interface MentionHighlightOptions {
  // Cmd/Ctrl+клик по упоминанию — открыть его документ (обычный клик ставит курсор,
  // иначе текст с названием было бы невозможно редактировать).
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
          handleClick(_view, _pos, event) {
            if (!event.metaKey && !event.ctrlKey) return false;
            const el = (event.target as HTMLElement | null)?.closest?.(".mention[data-mention]");
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
