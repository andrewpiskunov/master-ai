import type { ImgHTMLAttributes } from "react";
import { useDeletedImageIds } from "./image-deletions.js";

export type ThumbnailSize = 128 | 256 | 512;

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & {
  imageId: string;
  size?: ThumbnailSize;
  alt: string;
};

// Оригинал загружается только в ImageViewer/PlayerScreen. Даже при ошибке
// миниатюры не подменяем её многомегабайтным файлом.
export function ThumbnailImage({ imageId, size = 256, alt, ...props }: Props) {
  const deleted = useDeletedImageIds();
  if (deleted.has(imageId)) return null;
  const path = `/api/images/${encodeURIComponent(imageId)}/thumbnail`;
  return <img loading="lazy" decoding="async" {...props} alt={alt}
    src={`${path}?size=${size}`}
    srcSet={`${path}?size=${size} 1x, ${path}?size=${size * 2} 2x`} />;
}
