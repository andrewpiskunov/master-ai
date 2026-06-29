import ReactMarkdown from "react-markdown";

// Рендер markdown-ответов ИИ (жирный, курсив, заголовки, списки).
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
