import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface MentionItem { title: string; type: string }

export const mentionKey = new PluginKey("mentionHighlight");

const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

// Подсвечивает в тексте упоминания других сущностей кампании цветом их типа.
function buildDecorations(doc: PMNode, mentions: MentionItem[]): DecorationSet {
  const list = mentions
    .filter((m) => m.title.trim().length >= 3)
    .sort((a, b) => b.title.length - a.title.length);
  if (!list.length) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    const lower = text.toLowerCase();
    const taken = new Array(text.length).fill(false);
    for (const m of list) {
      const needle = m.title.toLowerCase();
      let idx = lower.indexOf(needle);
      while (idx !== -1) {
        const end = idx + needle.length;
        const before = idx === 0 ? " " : text[idx - 1];
        const after = end >= text.length ? " " : text[end];
        let free = true;
        for (let i = idx; i < end; i++) if (taken[i]) { free = false; break; }
        if (free && !isWordChar(before) && !isWordChar(after)) {
          decos.push(Decoration.inline(pos + idx, pos + end, { class: `mention mention-${m.type}` }));
          for (let i = idx; i < end; i++) taken[i] = true;
        }
        idx = lower.indexOf(needle, end);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

export const MentionHighlight = Extension.create({
  name: "mentionHighlight",
  addProseMirrorPlugins() {
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
        },
      }),
    ];
  },
});
