import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeMentions } from "./rehype-mentions.js";
import type { MentionItem } from "../lib/mentions.js";

// Внутренние ссылки (упоминания сущностей) — SPA-переход; внешние — обычная ссылка.
function MdLink({ href, className, children }: ComponentProps<"a">) {
  if (href && href.startsWith("/")) {
    return <Link to={href} className={className}>{children}</Link>;
  }
  return <a href={href} className={className} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function MdTable({ children }: ComponentProps<"table">) {
  return (
    <div className="md-table-scroll" role="region" aria-label="Таблица" tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

// Общий рендер Markdown-ответов ИИ, включая таблицы GitHub Flavored Markdown.
// mentions — сущности кампании; их упоминания становятся кликабельными ссылками (по href).
export function Markdown({ children, mentions }: { children: string; mentions?: MentionItem[] }) {
  const rehypePlugins = mentions && mentions.length ? [rehypeMentions(mentions)] : [];
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={{ a: MdLink, table: MdTable }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
