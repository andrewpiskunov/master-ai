import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { streamComplete } from "../api/stream.js";
import { useToast } from "../ui/toast.js";
import { SuggestionMark } from "./SuggestionMark.js";
import { MentionHighlight, mentionKey, type MentionItem } from "./MentionHighlight.js";

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

interface SlashCommand { title: string; hint: string; keywords: string[]; run: (e: Editor) => void }

// Команды по «/» — как в Campaign Arks: вставка блоков разметки.
const SLASH_COMMANDS: SlashCommand[] = [
  { title: "Текст", hint: "Обычный абзац", keywords: ["текст", "параграф", "paragraph", "text"], run: (e) => e.chain().focus().setParagraph().run() },
  { title: "Заголовок", hint: "Крупный заголовок", keywords: ["заголовок", "heading", "h2"], run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: "Подзаголовок", hint: "Заголовок раздела", keywords: ["подзаголовок", "heading", "h3"], run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: "Маркированный список", hint: "Список с точками", keywords: ["список", "маркированный", "bullet", "ul"], run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Нумерованный список", hint: "Список по порядку", keywords: ["список", "нумерованный", "ordered", "ol"], run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Цитата", hint: "Выделенная цитата", keywords: ["цитата", "quote", "blockquote"], run: (e) => e.chain().focus().toggleBlockquote().run() },
];

interface SlashState { items: SlashCommand[]; index: number; top: number; left: number; queryLen: number }

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(function DocumentEditor(
  { content, onChange, mentions },
  ref,
) {
  const { showToast } = useToast();
  const [suggesting, setSuggesting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  // диапазон вставленного предложения в позициях ProseMirror
  const range = useRef<{ from: number; to: number }>({ from: 0, to: 0 });
  // Fix 1: не вызывать onChange во время стриминга
  const streamingRef = useRef(false);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const activeSlashRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeSlashRef.current?.scrollIntoView({ block: "nearest" }); }, [slash?.index]);

  // Показ/скрытие меню «/» по тексту перед курсором.
  function detectSlash(ed: Editor) {
    if (streamingRef.current) { setSlash(null); return; }
    const sel = ed.state.selection;
    if (!sel.empty) { setSlash(null); return; }
    const $from = sel.$from;
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "￼");
    const m = /(?:^|\s)\/([^/\s]*)$/.exec(textBefore);
    if (!m) { setSlash(null); return; }
    const query = m[1].toLowerCase();
    const items = SLASH_COMMANDS.filter(
      (c) => !query || c.title.toLowerCase().includes(query) || c.keywords.some((k) => k.includes(query)),
    );
    if (items.length === 0) { setSlash(null); return; }
    const coords = ed.view.coordsAtPos($from.pos);
    setSlash({ items, index: 0, top: coords.bottom + 4, left: coords.left, queryLen: m[1].length });
  }

  const editor = useEditor({
    extensions: [StarterKit, SuggestionMark, MentionHighlight],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => {
      if (!streamingRef.current) onChange(editor.getJSON());
      detectSlash(editor);
    },
    onSelectionUpdate: ({ editor }) => detectSlash(editor),
  });

  // Позволяет ИИ-помощнику применять новый текст прямо в документ.
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

  function applySlash(cmd: SlashCommand) {
    if (!editor) return;
    const to = editor.state.selection.$from.pos;
    const from = to - ((slash?.queryLen ?? 0) + 1); // «/» + запрос
    editor.chain().focus().deleteRange({ from, to }).run();
    cmd.run(editor);
    setSlash(null);
  }

  // Навигация по меню «/» с клавиатуры (перехватываем до ProseMirror).
  useEffect(() => {
    if (!slash) return;
    const { items, index } = slash;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setSlash((p) => p && { ...p, index: (p.index + 1) % p.items.length }); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setSlash((p) => p && { ...p, index: (p.index - 1 + p.items.length) % p.items.length }); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); applySlash(items[index]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setSlash(null); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [slash]); // eslint-disable-line react-hooks/exhaustive-deps

  async function requestSuggestion() {
    if (!editor) return;
    const docText = editor.getText();
    const from = editor.state.selection.to;
    range.current = { from, to: from };
    streamingRef.current = true;
    setStreaming(true);
    setSuggesting(true);
    editor.setEditable(false);
    try {
      await streamComplete(
        {
          system: "Ты — соавтор мастера настольных ролевых игр. Продолжи документ по-русски, кратко и по делу.",
          messages: [{ role: "user", content: `Текущий документ:\n${docText}\n\nПродолжи его.` }],
        },
        (chunk) => {
          const at = range.current.to;
          editor
            .chain()
            .insertContentAt(at, { type: "text", text: chunk, marks: [{ type: "suggestion" }] })
            .run();
          range.current = { from: range.current.from, to: editor.state.selection.to };
        },
      );
      // Стрим завершён — превращаем markdown в оформленный текст (чтобы не висели «**» и «-»).
      formatSuggestion();
    } catch (err) {
      // Fix 2: сохранить частичный стрим как предложение; удалять только если ничего не вставлено
      const { from, to } = range.current;
      editor.setEditable(true);
      if (to > from) {
        // частичный стрим — тоже оформляем и оставляем как предложение
        formatSuggestion();
        showToast("ИИ прервался — можно принять или отклонить начатое");
      } else {
        setSuggesting(false);
        showToast(err instanceof Error ? `Ошибка ИИ: ${err.message}` : "Ошибка ИИ");
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  }

  // Превращает markdown из стрима в оформленный текст и заново помечает диапазон
  // как предложение — чтобы превью не висело с «**» и «-», а выглядело как итог.
  function formatSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    if (to <= from) return;
    const raw = editor.state.doc.textBetween(from, to, "\n").trim();
    if (!raw) return;
    editor.chain().deleteRange({ from, to }).insertContentAt(from, textToHtml(raw)).run();
    const newTo = editor.state.selection.to;
    editor.chain().setTextSelection({ from, to: newTo }).setMark("suggestion").run();
    range.current = { from, to: newTo };
  }

  function acceptSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    // Текст уже оформлен при завершении стрима — просто снимаем пометку «предложение».
    if (to > from) editor.chain().focus().setTextSelection({ from, to }).unsetMark("suggestion").run();
    editor.setEditable(true);
    setSuggesting(false);
    // Fix 5: явный вызов onChange оставлен — onUpdate в jsdom не гарантирует вызов от chain().run()
    onChange(editor.getJSON());
  }

  function rejectSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    if (to > from) editor.chain().deleteRange({ from, to }).run();
    editor.setEditable(true);
    setSuggesting(false);
    // Fix 5: явный вызов onChange оставлен — onUpdate в jsdom не гарантирует вызов от chain().run()
    onChange(editor.getJSON());
  }

  const fmtDisabled = !editor || suggesting || streaming;
  const isActive = (name: string, attrs?: Record<string, unknown>) => editor?.isActive(name, attrs) ?? false;

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="editor-format">
          <button type="button" title="Жирный" disabled={fmtDisabled}
            className={isActive("bold") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleBold().run()}><strong>Ж</strong></button>
          <button type="button" title="Курсив" disabled={fmtDisabled}
            className={isActive("italic") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleItalic().run()}><em>К</em></button>
          <span className="editor-sep" />
          <button type="button" title="Заголовок" disabled={fmtDisabled}
            className={isActive("heading", { level: 2 }) ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button type="button" title="Подзаголовок" disabled={fmtDisabled}
            className={isActive("heading", { level: 3 }) ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
          <span className="editor-sep" />
          <button type="button" title="Маркированный список" disabled={fmtDisabled}
            className={isActive("bulletList") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</button>
          <button type="button" title="Нумерованный список" disabled={fmtDisabled}
            className={isActive("orderedList") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</button>
          <button type="button" title="Цитата" disabled={fmtDisabled}
            className={isActive("blockquote") ? "active" : ""}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❝</button>
        </div>
        <div className="editor-ai">
          {!suggesting && (
            <button type="button" onClick={requestSuggestion} disabled={streaming}
              title="ИИ продолжит документ с места курсора и оформит разметку">
              ✨ Дописать ИИ
            </button>
          )}
          {suggesting && !streaming && (
            <>
              <button type="button" onClick={acceptSuggestion}>Принять</button>
              <button type="button" onClick={rejectSuggestion}>Отклонить</button>
            </>
          )}
          {streaming && <span className="muted">ИИ печатает…</span>}
        </div>
      </div>
      <EditorContent editor={editor} />
      <p className="editor-hint">Введите «/» для команд форматирования</p>
      {slash && (
        <ul className="slash-menu" role="listbox" style={{ top: slash.top, left: slash.left }}>
          {slash.items.map((c, i) => (
            <li
              key={c.title}
              ref={i === slash.index ? activeSlashRef : undefined}
              role="option"
              aria-selected={i === slash.index}
              className={`slash-option${i === slash.index ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); applySlash(c); }}
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
