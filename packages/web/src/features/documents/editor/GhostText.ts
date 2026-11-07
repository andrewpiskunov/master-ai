import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Серый «призрачный» текст-подсказка ИИ после курсора; Tab — принять, Esc — отклонить.
export const ghostKey = new PluginKey<{ text: string }>("ghostText");

export const GhostText = Extension.create({
  name: "ghostText",
  addProseMirrorPlugins() {
    return [
      new Plugin<{ text: string }>({
        key: ghostKey,
        state: {
          init: () => ({ text: "" }),
          apply(tr, value) {
            const meta = tr.getMeta(ghostKey) as string | undefined;
            if (meta !== undefined) return { text: meta };
            if (tr.docChanged || tr.selectionSet) return { text: "" };
            return value;
          },
        },
        props: {
          decorations(state) {
            const text = ghostKey.getState(state)?.text;
            const sel = state.selection;
            if (!text || !sel.empty) return null;
            const widget = document.createElement("span");
            widget.className = "ghost-text";
            widget.textContent = text;
            return DecorationSet.create(state.doc, [Decoration.widget(sel.head, widget, { side: 1 })]);
          },
          handleKeyDown(view, event) {
            const text = ghostKey.getState(view.state)?.text;
            if (!text) return false;
            if (event.key === "Tab") {
              event.preventDefault();
              const tr = view.state.tr.insertText(text, view.state.selection.head);
              tr.setMeta(ghostKey, "");
              view.dispatch(tr);
              return true;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              view.dispatch(view.state.tr.setMeta(ghostKey, ""));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
