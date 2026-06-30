import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { getDocumentType } from "@master-ai/shared";
import { streamComplete } from "../api/stream.js";
import { MentionHighlight, mentionKey, type MentionItem } from "./MentionHighlight.js";
import { Placeholder } from "./Placeholder.js";
import { GhostText, ghostKey } from "./GhostText.js";

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
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [autocomplete, setAutocomplete] = useState(() => {
    try { return localStorage.getItem("ai-autocomplete") !== "off"; } catch { return true; }
  });
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostToken = useRef(0);
  const autocompleteRef = useRef(autocomplete);
  autocompleteRef.current = autocomplete;
  const mentionsRef = useRef<MentionItem[]>(mentions ?? []);
  mentionsRef.current = mentions ?? [];
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [menu?.index]);

  // Плавающая панель форматирования над выделенным текстом.
  function detectBubble(ed: Editor) {
    const sel = ed.state.selection;
    if (sel.empty || !ed.isFocused) { setBubble(null); return; }
    const a = ed.view.coordsAtPos(sel.from);
    const b = ed.view.coordsAtPos(sel.to);
    setBubble({ top: Math.min(a.top, b.top) - 10, left: (a.left + b.right) / 2 });
  }

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

  // Запрос ИИ-продолжения (ghost-текст) после паузы в наборе.
  function scheduleGhost(ed: Editor) {
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
    if (!autocompleteRef.current) return;
    ghostTimer.current = setTimeout(() => {
      const sel = ed.state.selection;
      if (!sel.empty) return;
      const $head = sel.$from;
      if ($head.parentOffset !== $head.parent.content.size) return; // только в конце блока
      const before = ed.state.doc.textBetween(0, sel.head, "\n", " ");
      if (before.trim().length < 20) return;
      const token = ++ghostToken.current;
      const head = sel.head;
      const size = ed.state.doc.content.size;
      let out = "";
      streamComplete(
        {
          system: "Ты — соавтор мастера настольных ролевых игр. Продолжи текст ОДНИМ коротким фрагментом (полфразы–одна фраза), естественно стыкуясь с уже написанным. Не повторяй написанное, без кавычек и пояснений. Верни только продолжение.",
          messages: [{ role: "user", content: `Текст:\n${before}\n\nПродолжи с этого места.` }],
        },
        (c) => { out += c; },
      ).then(() => {
        if (token !== ghostToken.current) return;
        const cur = ed.state.selection;
        if (!cur.empty || cur.head !== head || ed.state.doc.content.size !== size) return;
        let text = out.trim();
        if (!text) return;
        if (/\s$/.test(before) && /^\s/.test(text)) text = text.replace(/^\s+/, "");
        else if (!/\s$/.test(before) && !/^\s/.test(text)) text = ` ${text}`;
        ed.view.dispatch(ed.state.tr.setMeta(ghostKey, text));
      }).catch(() => {});
    }, 900);
  }

  const editor = useEditor({
    extensions: [StarterKit, MentionHighlight, Placeholder, GhostText],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => { onChange(editor.getJSON()); detectMenu(editor); detectBubble(editor); scheduleGhost(editor); },
    onSelectionUpdate: ({ editor }) => { detectMenu(editor); detectBubble(editor); },
    onBlur: () => setTimeout(() => setBubble(null), 150),
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

  const fmtActive = (name: string, attrs?: Record<string, unknown>) => editor?.isActive(name, attrs) ?? false;
  const run = (fn: (c: ReturnType<NonNullable<typeof editor>["chain"]>) => void) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    fn(chain);
    detectBubble(editor);
  };

  return (
    <div className="editor">
      <EditorContent editor={editor} />
      <div className="editor-footer">
        <p className="editor-hint">Введите «@», чтобы вставить или связать сущность · «/» — команды · Tab — принять подсказку ИИ</p>
        <button
          type="button"
          className={`autocomplete-toggle${autocomplete ? " on" : ""}`}
          title="ИИ-автодополнение текста"
          onClick={() => {
            const next = !autocomplete;
            setAutocomplete(next);
            try { localStorage.setItem("ai-autocomplete", next ? "on" : "off"); } catch { /* ignore */ }
            if (!next && editor) editor.view.dispatch(editor.state.tr.setMeta(ghostKey, ""));
          }}
        >
          <Sparkles size={13} /> Автодополнение: {autocomplete ? "вкл" : "выкл"}
        </button>
      </div>
      {bubble && editor && (
        <div className="bubble-menu" style={{ top: bubble.top, left: bubble.left }} onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className={fmtActive("paragraph") ? "active" : ""} title="Текст" onClick={() => run((c) => c.setParagraph().run())}>T</button>
          <button type="button" className={fmtActive("heading", { level: 2 }) ? "active" : ""} title="Заголовок" onClick={() => run((c) => c.toggleHeading({ level: 2 }).run())}>H2</button>
          <button type="button" className={fmtActive("heading", { level: 3 }) ? "active" : ""} title="Подзаголовок" onClick={() => run((c) => c.toggleHeading({ level: 3 }).run())}>H3</button>
          <span className="bubble-sep" />
          <button type="button" className={fmtActive("bold") ? "active" : ""} title="Жирный" onClick={() => run((c) => c.toggleBold().run())}><strong>Ж</strong></button>
          <button type="button" className={fmtActive("italic") ? "active" : ""} title="Курсив" onClick={() => run((c) => c.toggleItalic().run())}><em>К</em></button>
          <button type="button" className={fmtActive("strike") ? "active" : ""} title="Зачёркнутый" onClick={() => run((c) => c.toggleStrike().run())}><s>S</s></button>
          <span className="bubble-sep" />
          <button type="button" className={fmtActive("bulletList") ? "active" : ""} title="Список" onClick={() => run((c) => c.toggleBulletList().run())}>•</button>
          <button type="button" className={fmtActive("orderedList") ? "active" : ""} title="Нумерованный список" onClick={() => run((c) => c.toggleOrderedList().run())}>1.</button>
          <button type="button" className={fmtActive("blockquote") ? "active" : ""} title="Цитата" onClick={() => run((c) => c.toggleBlockquote().run())}>❝</button>
        </div>
      )}
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
