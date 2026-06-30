import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getDocumentType } from "@master-ai/shared";
import { MentionHighlight, mentionKey, type MentionItem } from "./MentionHighlight.js";
import { Placeholder } from "./Placeholder.js";

interface DocumentEditorProps {
  content: unknown;
  onChange: (json: unknown) => void;
  mentions?: MentionItem[];
}

export interface DocumentEditorHandle {
  applyText: (text: string) => void;
  insertReference: (title: string) => void;
}

// Построчная конвертация markdown-ишного текста в HTML для вставки в редактор:
// заголовки — отдельными блоками, подряд идущие пункты группируются в списки,
// подряд идущие текстовые строки — в абзац. Заголовок без пустой строки перед
// списком больше не «съедает» пункты.
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };

  for (let i = 0; i < lines.length; ) {
    const t = lines[i].trim();
    if (t === "") { flush(); i++; continue; }
    if (t.startsWith("### ")) { flush(); out.push(`<h3>${inline(t.slice(4))}</h3>`); i++; continue; }
    if (t.startsWith("## ")) { flush(); out.push(`<h2>${inline(t.slice(3))}</h2>`); i++; continue; }
    if (t.startsWith("# ")) { flush(); out.push(`<h2>${inline(t.slice(2))}</h2>`); i++; continue; }
    if (/^[-*]\s+/.test(t)) {
      flush();
      const items: string[] = [];
      for (; i < lines.length && /^[-*]\s+/.test(lines[i].trim()); i++)
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*]\s+/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      flush();
      const items: string[] = [];
      for (; i < lines.length && /^\d+\.\s+/.test(lines[i].trim()); i++)
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`);
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return out.join("");
}

// Markdown-текст → JSON-документ ProseMirror (для шаблонов и создаваемых сущностей).
export function markdownToDoc(text: string): unknown {
  return generateJSON(textToHtml(text) || "<p></p>", [StarterKit]);
}

interface MenuItem { id: string; title: string; hint: string; run: (e: Editor) => void }

// Команды по «/» — вставка блоков разметки (как в Campaign Arks).
const SLASH_COMMANDS: MenuItem[] = [
  { id: "p", title: "Текст", hint: "Обычный абзац", run: (e) => e.chain().focus().setParagraph().run() },
  { id: "h2", title: "Заголовок", hint: "Крупный заголовок", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3", title: "Подзаголовок", hint: "Заголовок раздела", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "ul", title: "Маркированный список", hint: "Список с точками", run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: "ol", title: "Нумерованный список", hint: "Список по порядку", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: "quote", title: "Цитата", hint: "Выделенная цитата", run: (e) => e.chain().focus().toggleBlockquote().run() },
];

const SLASH_KEYWORDS: Record<string, string[]> = {
  p: ["текст", "параграф", "paragraph", "text"],
  h2: ["заголовок", "heading", "h2"],
  h3: ["подзаголовок", "heading", "h3"],
  ul: ["список", "маркированный", "bullet", "ul"],
  ol: ["список", "нумерованный", "ordered", "ol"],
  quote: ["цитата", "quote", "blockquote"],
};

interface MenuState { kind: "slash" | "mention"; items: MenuItem[]; index: number; top: number; left: number; queryLen: number; triggerLen: number }

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function DocumentEditor(
  { content, onChange, mentions },
  ref,
) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const mentionsRef = useRef<MentionItem[]>(mentions ?? []);
  mentionsRef.current = mentions ?? [];
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [menu?.index]);

  // Меню по «/» (команды) и «@» (вставка сущностей кампании).
  function detectMenu(ed: Editor) {
    const sel = ed.state.selection;
    if (!sel.empty) { setMenu(null); return; }
    const $from = sel.$from;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "￼");

    const slashM = /(?:^|\s)\/([^/\s]*)$/.exec(textBefore);
    if (slashM) {
      const query = slashM[1].toLowerCase();
      const items = SLASH_COMMANDS.filter(
        (c) => !query || c.title.toLowerCase().includes(query) || (SLASH_KEYWORDS[c.id] ?? []).some((k) => k.includes(query)),
      );
      if (!items.length) { setMenu(null); return; }
      const coords = ed.view.coordsAtPos($from.pos);
      setMenu({ kind: "slash", items, index: 0, top: coords.bottom + 4, left: coords.left, queryLen: slashM[1].length, triggerLen: 1 });
      return;
    }

    const atM = /(?:^|\s)@([^@]*)$/.exec(textBefore);
    if (atM) {
      const query = atM[1].toLowerCase();
      const items: MenuItem[] = mentionsRef.current
        .filter((mn) => !query || mn.title.toLowerCase().includes(query))
        .slice(0, 8)
        .map((mn) => ({
          id: mn.title,
          title: mn.title,
          hint: getDocumentType(mn.type)?.label ?? mn.type,
          run: (e) => e.chain().focus().insertContent(`${mn.title} `).run(),
        }));
      if (!items.length) { setMenu(null); return; }
      const coords = ed.view.coordsAtPos($from.pos);
      setMenu({ kind: "mention", items, index: 0, top: coords.bottom + 4, left: coords.left, queryLen: atM[1].length, triggerLen: 1 });
      return;
    }

    setMenu(null);
  }

  const editor = useEditor({
    extensions: [StarterKit, MentionHighlight, Placeholder],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => { onChange(editor.getJSON()); detectMenu(editor); },
    onSelectionUpdate: ({ editor }) => detectMenu(editor),
  });

  useImperativeHandle(ref, () => ({
    applyText(text: string) {
      if (!editor) return;
      editor.commands.setContent(textToHtml(text), true);
      onChange(editor.getJSON());
    },
    // Вставляет упоминание сущности в позицию курсора (подсветится как ссылка).
    insertReference(title: string) {
      if (!editor) return;
      editor.chain().focus().insertContent(`${title} `).run();
      onChange(editor.getJSON());
    },
  }), [editor, onChange]);

  // Передаём список сущностей в плагин подсветки упоминаний.
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(mentionKey, { mentions: mentions ?? [] }));
  }, [editor, mentions]);

  function applyMenu(item: MenuItem) {
    if (!editor || !menu) return;
    const to = editor.state.selection.$from.pos;
    const from = to - (menu.queryLen + menu.triggerLen);
    editor.chain().focus().deleteRange({ from, to }).run();
    item.run(editor);
    setMenu(null);
  }

  // Навигация по меню с клавиатуры (перехватываем до ProseMirror).
  useEffect(() => {
    if (!menu) return;
    const { items, index } = menu;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setMenu((p) => p && { ...p, index: (p.index + 1) % p.items.length }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setMenu((p) => p && { ...p, index: (p.index - 1 + p.items.length) % p.items.length }); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); applyMenu(items[index]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setMenu(null); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="editor">
      <EditorContent editor={editor} />
      <p className="editor-hint">Введите «@», чтобы вставить или связать сущность кампании</p>
      {menu && (
        <ul className="slash-menu" role="listbox" style={{ top: menu.top, left: menu.left }}>
          {menu.items.map((c, i) => (
            <li
              key={`${c.id}-${i}`}
              ref={i === menu.index ? activeRef : undefined}
              role="option"
              aria-selected={i === menu.index}
              className={`slash-option${i === menu.index ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); applyMenu(c); }}
            >
              <span className="slash-title">{c.title}</span>
              <span className="slash-hint">{c.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
