import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface DocumentEditorProps {
  content: unknown;
  onChange: (json: unknown) => void;
}

export function DocumentEditor({ content, onChange }: DocumentEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  return <EditorContent editor={editor} />;
}
