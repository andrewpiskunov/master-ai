import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { matchMentions, prepareMentions, type MentionItem } from "../mentions.js";

export type { MentionItem };

export const mentionKey = new PluginKey("mentionHighlight");

// Подсвечивает в тексте упоминания других сущностей кампании цветом их типа.
function buildDecorations(doc: PMNode, mentions: MentionItem[]): DecorationSet {
  const prepared = prepareMentions(mentions);
  if (!prepared.length) return DecorationSet.empty;

  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const s of matchMentions(node.text, prepared)) {
      decos.push(Decoration.inline(pos + s.start, pos + s.end, { class: `mention mention-${s.type}` }));
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
