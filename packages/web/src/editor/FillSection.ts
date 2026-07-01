import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Кнопка «✨» у каждого заголовка 2-го уровня — «заполнить этот раздел с ИИ».
// Клик вызывает onFill(headingText); саму генерацию делает страница документа.
// Состояние `filling` (заголовок заполняемого раздела) приходит через setMeta и
// подсвечивает раздел + крутилку на время работы ИИ.
export const fillSectionKey = new PluginKey<{ filling: string | null }>("fillSection");

export const FillSection = Extension.create<{ onFill: (heading: string) => void }>({
  name: "fillSection",
  addOptions() {
    return { onFill: () => {} };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<{ filling: string | null }>({
        key: fillSectionKey,
        state: {
          init: () => ({ filling: null }),
          apply(tr, value) {
            const meta = tr.getMeta(fillSectionKey) as { filling: string | null } | undefined;
            return meta ? { filling: meta.filling } : value;
          },
        },
        props: {
          decorations(state) {
            const filling = fillSectionKey.getState(state)?.filling ?? null;
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (node.type.name !== "heading" || node.attrs.level !== 2) return;
              const heading = node.textContent;
              const isFilling = filling !== null && heading.trim() === filling.trim();

              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = `fill-section-btn${isFilling ? " filling" : ""}`;
              btn.title = isFilling ? "ИИ заполняет раздел…" : "Заполнить раздел с ИИ";
              btn.setAttribute("aria-label", `Заполнить раздел «${heading}» с ИИ`);
              btn.textContent = isFilling ? "⏳" : "✨";
              btn.contentEditable = "false";
              if (isFilling) btn.disabled = true;
              btn.addEventListener("mousedown", (e) => {
                e.preventDefault();
                if (!isFilling) options.onFill(heading);
              });
              decos.push(Decoration.widget(offset + node.nodeSize - 1, btn, { side: 1, key: `fill-${offset}-${isFilling}` }));

              if (isFilling) {
                decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "pm-filling" }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
