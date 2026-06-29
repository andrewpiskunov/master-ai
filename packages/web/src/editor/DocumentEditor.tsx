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

  const editor = useEditor({
    extensions: [StarterKit, SuggestionMark],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  async function requestSuggestion() {
    if (!editor) return;
    const docText = editor.getText();
    const from = editor.state.selection.to;
    range.current = { from, to: from };
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
      // убрать частично вставленное и сообщить
      const { from, to } = range.current;
      if (to > from) editor.chain().deleteRange({ from, to }).run();
      setSuggesting(false);
      editor.setEditable(true);
      showToast(err instanceof Error ? `Ошибка ИИ: ${err.message}` : "Ошибка ИИ");
    } finally {
      setStreaming(false);
    }
  }

  function acceptSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    editor.chain().setTextSelection({ from, to }).unsetMark("suggestion").setTextSelection(to).run();
    editor.setEditable(true);
    setSuggesting(false);
    onChange(editor.getJSON());
  }

  function rejectSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    if (to > from) editor.chain().deleteRange({ from, to }).run();
    editor.setEditable(true);
    setSuggesting(false);
    onChange(editor.getJSON());
  }

  return (
    <div>
      <div className="editor-toolbar">
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
        {streaming && <span>ИИ печатает…</span>}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
