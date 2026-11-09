import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { ImageAttachment } from "@master-ai/shared";
import { api, ApiError } from "../../api/client.js";
import { imageError } from "./useImageDraft.js";
import { notifyImageDeleted } from "./image-deletions.js";
import { ThumbnailImage } from "./ThumbnailImage.js";
import { lockImageScroll } from "./scroll-lock.js";
import "./DeleteImageButton.css";

export function DeleteImageButton({ image, disabled, compact = true }: { image: ImageAttachment; disabled?: boolean; compact?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" className="btn-ghost image-delete-button" disabled={disabled} title="Удалить изображение из кампании" aria-label={`Удалить ${image.name}`} onClick={() => setConfirming(true)}>
      <Trash2 size={compact ? 14 : 16} />{!compact && <span>Удалить</span>}
    </button>
    {confirming && <DeleteConfirmation key={image.id} image={image} onClose={() => { setConfirming(false); trigger.current?.focus(); }} />}
  </>;
}

function DeleteConfirmation({ image, onClose }: { image: ImageAttachment; onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const active = useRef(true);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    active.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockImageScroll();
    cancel.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!busy.current) closeRef.current();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopPropagation();
      } else if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
        if (!controls?.length) { event.preventDefault(); dialog.current?.focus(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        const outside = !dialog.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      active.current = false;
      unlock();
      window.removeEventListener("keydown", onKey, true);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function remove() {
    if (busy.current) return;
    busy.current = true; setWorking(true); setError("");
    try {
      try { await api.deleteImage(image.id); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; }
      notifyImageDeleted(image.id);
      if (active.current) closeRef.current();
    } catch (e) {
      if (active.current) setError(imageError(e));
    } finally {
      if (active.current) { busy.current = false; setWorking(false); }
    }
  }

  return createPortal(<div className="image-delete-backdrop" data-image-delete-dialog onClick={(event) => {
    if (event.target === event.currentTarget && !busy.current) closeRef.current();
  }}>
    <div ref={dialog} className="image-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <div className="image-delete-heading"><Trash2 size={22} /><h2 id={titleId}>Удалить изображение?</h2></div>
      <div className="image-delete-file"><ThumbnailImage imageId={image.id} size={128} alt="" /><strong>{image.name}</strong></div>
      <p id={descriptionId}>Изображение исчезнет из всех карточек и переписок кампании, включая аватарки и обложку. Это действие нельзя отменить.</p>
      {error && <p className="image-error" role="alert">{error}</p>}
      <div className="image-delete-actions"><button ref={cancel} type="button" className="btn-ghost" disabled={working} onClick={onClose}>Отмена</button><button type="button" className="image-delete-confirm" disabled={working} onClick={() => { void remove(); }}><Trash2 size={15} />{working ? "Удаляю…" : "Удалить изображение"}</button></div>
    </div>
  </div>, document.body);
}
