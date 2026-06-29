import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { rehypeMentions } from "./rehype-mentions.js";
import type { MentionItem } from "../mentions.js";

// Внутренние ссылки (упоминания сущностей) — SPA-переход; внешние — обычная ссылка.
function MdLink({ href, className, children }: ComponentProps<"a">) {
  if (href && href.startsWith("/")) {
    return <Link to={href} className={className}>{children}</Link>;
  }
  return <a href={href} className={className} target="_blank" rel="noopener noreferrer">{children}</a>;
}

// Рендер markdown-ответов ИИ (жирный, курсив, заголовки, списки).
// mentions — сущности кампании; их упоминания становятся кликабельными ссылками (по href).
export function Markdown({ children, mentions }: { children: string; mentions?: MentionItem[] }) {
  const rehypePlugins = mentions && mentions.length ? [rehypeMentions(mentions)] : [];
  return (
    <div className="md">
      <ReactMarkdown rehypePlugins={rehypePlugins} components={{ a: MdLink }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
