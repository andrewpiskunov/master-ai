import { createContext, useContext, type ComponentProps } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeMentions } from "./rehype-mentions.js";
import type { MentionItem } from "../lib/mentions.js";
import { ImagePreview } from "../features/images/ImageViewer.js";
import { ThumbnailImage } from "../features/images/ThumbnailImage.js";

const InsideLink = createContext(false);

// Внутренние ссылки (упоминания сущностей) — SPA-переход; внешние — обычная ссылка.
function MdLink({ href, className, children }: ComponentProps<"a">) {
  return <InsideLink.Provider value={true}>{href?.startsWith("/")
    ? <Link to={href} className={className}>{children}</Link>
    : <a href={href} className={className} target="_blank" rel="noopener noreferrer">{children}</a>
  }</InsideLink.Provider>;
}

function MdTable({ children }: ComponentProps<"table">) {
  return (
    <div className="md-table-scroll" role="region" aria-label="Таблица" tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

function MdImage({ src, alt, title }: ComponentProps<"img">) {
  const insideLink = useContext(InsideLink);
  let imageId: string | undefined;
  try {
    const url = src ? new URL(src, window.location.origin) : null;
    if (url?.origin === window.location.origin) imageId = /^\/api\/images\/([\w-]+)$/.exec(url.pathname)?.[1];
  } catch { /* Неправильная ссылка не должна ломать весь ответ. */ }
  if (imageId) return insideLink
    ? <ThumbnailImage imageId={imageId} size={512} alt={alt ?? ""} title={title} />
    : <ImagePreview images={[{ id: imageId, name: alt || title || "Изображение", mimeType: "image/webp" }]} thumbnailSize={512} className="md-image-preview" />;
  return <img src={src} alt={alt ?? ""} title={title} loading="lazy" decoding="async" />;
}

// Общий рендер Markdown-ответов ИИ, включая таблицы GitHub Flavored Markdown.
// mentions — сущности кампании; их упоминания становятся кликабельными ссылками (по href).
export function Markdown({ children, mentions }: { children: string; mentions?: MentionItem[] }) {
  const rehypePlugins = mentions && mentions.length ? [rehypeMentions(mentions)] : [];
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={{ a: MdLink, table: MdTable, img: MdImage }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
