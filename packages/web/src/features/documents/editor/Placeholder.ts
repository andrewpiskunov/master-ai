import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Подсказка в пустом блоке, где стоит курсор (как в Notion/Arks): «… или «/» для команд».
// Своя мини-реализация, чтобы не тянуть @tiptap/extension-placeholder.
export const Placeholder = Extension.create<{ text: string }>({
  name: "placeholder",
  addOptions() {
    return { text: "Введите текст или «/» для команд" };
  },
  addProseMirrorPlugins() {
    const text = this.options.text;
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const { doc, selection } = state;
            if (!selection.empty) return null;
            const parent = selection.$from.parent;
            if (!parent.isTextblock || parent.content.size > 0) return null;
            const pos = selection.$from.before();
            return DecorationSet.create(doc, [
              Decoration.node(pos, pos + parent.nodeSize, {
                class: "pm-empty",
                "data-placeholder": text,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
