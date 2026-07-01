import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Кнопка «✨» у каждого заголовка 2-го уровня — «заполнить этот раздел с ИИ».
// Клик вызывает onFill(headingText); саму генерацию делает страница документа.
export const fillSectionKey = new PluginKey("fillSection");

export const FillSection = Extension.create<{ onFill: (heading: string) => void }>({
  name: "fillSection",
  addOptions() {
    return { onFill: () => {} };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: fillSectionKey,
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (node.type.name !== "heading" || node.attrs.level !== 2) return;
              const heading = node.textContent;
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "fill-section-btn";
              btn.title = "Заполнить раздел с ИИ";
              btn.setAttribute("aria-label", `Заполнить раздел «${heading}» с ИИ`);
              btn.textContent = "✨";
              btn.contentEditable = "false";
              btn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                options.onFill(heading);
              });
              // В конце строки заголовка, после текста.
              decos.push(Decoration.widget(offset + node.nodeSize - 1, btn, { side: 1, key: `fill-${offset}` }));
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
