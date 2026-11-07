import { useId, useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import type { ImageAttachment } from "@master-ai/shared";
import type { ImageDraft } from "./useImageDraft.js";

export function MessageImages({ images }: { images?: ImageAttachment[] }) {
  if (!images?.length) return null;
  return <div className="message-images">{images.map((image) => (
    <a key={image.id} href={`/api/images/${image.id}`} target="_blank" rel="noopener noreferrer" title={`Открыть ${image.name}`}>
      <img src={`/api/images/${image.id}`} alt={image.name} loading="lazy" />
    </a>
  ))}</div>;
}

export function ImageAttachments({ draft, disabled = false }: { draft: ImageDraft; disabled?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  return <div className="image-attachments">
    {draft.items.length > 0 && <ul className="image-draft" aria-label="Прикреплённые изображения">
      {draft.items.map((image) => <li key={image.key}>
        {image.dataUrl ? <img src={image.dataUrl} alt={image.name} /> : <span className="image-reading">Читаю…</span>}
        <span className="image-draft-name" title={image.name}>{image.name}</span>
        <button type="button" className="image-remove" aria-label={`Убрать ${image.name}`} disabled={disabled} onClick={() => draft.remove(image.key)}><X size={13} /></button>
      </li>)}
    </ul>}
    <div className="image-attach-bar">
      <button type="button" className="btn-ghost image-attach-button" disabled={disabled} aria-describedby={hintId} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Изображение</button>
      <span id={hintId} className="image-paste-hint">или вставьте ⌘V / Ctrl+V · до 4 × 10 МБ</span>
      <input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Выбрать изображения" disabled={disabled} onChange={(e) => {
        if (e.target.files) draft.addFiles(e.target.files);
        e.target.value = "";
      }} />
    </div>
    {draft.error && <p className="image-error" role="alert">{draft.error}</p>}
  </div>;
}
