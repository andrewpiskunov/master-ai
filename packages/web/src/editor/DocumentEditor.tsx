import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { streamComplete } from "../api/stream.js";
import { useToast } from "../ui/toast.js";
import { SuggestionMark } from "./SuggestionMark.js";

interface DocumentEditorProps {
  content: unknown;
  onChange: (json: unknown) => void;
}

export function DocumentEditor({ content, onChange }: DocumentEditorProps) {
  const { showToast } = useToast();
  const [suggesting, setSuggesting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  // диапазон вставленного предложения в позициях ProseMirror
  const range = useRef<{ from: number; to: number }>({ from: 0, to: 0 });
  // Fix 1: не вызывать onChange во время стриминга
  const streamingRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit, SuggestionMark],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => {
      if (!streamingRef.current) onChange(editor.getJSON());
    },
  });

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
    } catch (err) {
      // Fix 2: сохранить частичный стрим как предложение; удалять только если ничего не вставлено
      const { from, to } = range.current;
      editor.setEditable(true);
      if (to > from) {
        // частичный стрим — оставить как предложение, Принять/Отклонить остаются доступны
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

  function acceptSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    editor.chain().setTextSelection({ from, to }).unsetMark("suggestion").setTextSelection(to).run();
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
            <button type="button" onClick={requestSuggestion} disabled={streaming}>
              ✨ Продолжить
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
    </div>
  );
}
