import ReactMarkdown from "react-markdown";
import { rehypeMentions } from "./rehype-mentions.js";
import type { MentionItem } from "../mentions.js";

// Рендер markdown-ответов ИИ (жирный, курсив, заголовки, списки).
// mentions — сущности кампании, упоминания которых подсвечиваются цветом типа.
export function Markdown({ children, mentions }: { children: string; mentions?: MentionItem[] }) {
  const rehypePlugins = mentions && mentions.length ? [rehypeMentions(mentions)] : [];
  return (
    <div className="md">
      <ReactMarkdown rehypePlugins={rehypePlugins}>{children}</ReactMarkdown>
    </div>
  );
}
