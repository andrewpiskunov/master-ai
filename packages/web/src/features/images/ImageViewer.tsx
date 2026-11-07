import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Expand, ImageOff, Scan, X } from "lucide-react";
import type { ImageAttachment } from "@master-ai/shared";
import "./ImageViewer.css";

interface ImageViewerProps {
  images: ImageAttachment[];
  initialIndex?: number;
  onClose: () => void;
}

export function ImageViewer({ images, initialIndex = 0, onClose }: ImageViewerProps) {
  if (!images.length) return null;
  return <ImageViewerContent key={images.map((image) => image.id).join("|")} images={images} initialIndex={initialIndex} onClose={onClose} />;
}

function ImageViewerContent({ images, initialIndex = 0, onClose }: ImageViewerProps) {
  const [index, setIndex] = useState(Math.max(0, Math.min(initialIndex, images.length - 1)));
  const [zoomed, setZoomed] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const image = images[index];

  const navigate = useCallback((direction: number) => {
    setIndex((current) => (current + direction + images.length) % images.length);
    setZoomed(false);
    setFailedImage(null);
    canvas.current?.scrollTo?.(0, 0);
  }, [images.length]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        navigate(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Tab") {
        const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        const outside = !dialog.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [navigate]);

  return createPortal(<div className="image-viewer-backdrop" onClick={(event) => {
    if (event.target === event.currentTarget) onCloseRef.current();
  }}>
    <div ref={dialog} className="image-viewer" role="dialog" aria-modal="true" aria-label="Просмотр изображения">
      <header className="image-viewer-header">
        <div className="image-viewer-heading">
          <span className="image-viewer-eyebrow">Галерея <span aria-live="polite">{index + 1} / {images.length}</span></span>
          <h2 title={image.name}>{image.name}</h2>
        </div>
        <button ref={closeButton} type="button" className="image-viewer-icon" aria-label="Закрыть просмотр" title="Закрыть (Esc)" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      <div className="image-viewer-stage">
        <div ref={canvas} className={`image-viewer-canvas${zoomed ? " is-zoomed" : ""}`}>
          {failedImage === image.id ? <div className="image-viewer-error" role="alert">
            <ImageOff size={34} strokeWidth={1.25} />
            <strong>Не удалось загрузить изображение</strong>
            <p>Файл недоступен. Попробуйте открыть его позже.</p>
          </div> : <img key={image.id} className="image-viewer-image" src={`/api/images/${image.id}`} alt={image.name} draggable={false} onError={() => setFailedImage(image.id)} />}
        </div>
        {images.length > 1 && <>
          <button type="button" className="image-viewer-icon image-viewer-previous" aria-label="Предыдущее изображение" title="Предыдущее (←)" onClick={() => navigate(-1)}><ChevronLeft size={23} /></button>
          <button type="button" className="image-viewer-icon image-viewer-next" aria-label="Следующее изображение" title="Следующее (→)" onClick={() => navigate(1)}><ChevronRight size={23} /></button>
        </>}
      </div>
      <footer className="image-viewer-footer">
        <span className="image-viewer-shortcuts"><kbd>Esc</kbd> закрыть{images.length > 1 && <><span>·</span><kbd>←</kbd><kbd>→</kbd> листать</>}</span>
        <div className="image-viewer-tools">
          <button type="button" aria-label="Масштаб 100%" aria-pressed={zoomed} disabled={failedImage === image.id} onClick={() => setZoomed((value) => !value)} title={zoomed ? "Вписать в окно" : "Показать в исходном размере"}>
            {zoomed ? <Scan size={16} /> : <Expand size={16} />}<span>{zoomed ? "Вписать" : "100%"}</span>
          </button>
          <a href={`/api/images/${image.id}`} download={image.name} aria-label="Скачать изображение" title="Скачать изображение"><Download size={16} /><span>Скачать</span></a>
        </div>
      </footer>
    </div>
  </div>, document.body);
}

export function ImagePreview({ images, index = 0, className, label }: {
  images: ImageAttachment[];
  index?: number;
  className?: string;
  label?: string;
}) {
  const [openedCollection, setOpenedCollection] = useState<string | null>(null);
  const collection = images.map((image) => image.id).join("|");
  useEffect(() => { setOpenedCollection(null); }, [collection]);
  const image = images[index];
  if (!image) return null;
  const title = label ?? `Открыть ${image.name}`;
  return <>
    <button type="button" className={`image-preview${className ? ` ${className}` : ""}`} aria-label={title} aria-haspopup="dialog" title={title} onClick={() => setOpenedCollection(collection)}>
      <img src={`/api/images/${image.id}`} alt={image.name} loading="lazy" />
    </button>
    {openedCollection === collection && <ImageViewer images={images} initialIndex={index} onClose={() => setOpenedCollection(null)} />}
  </>;
}
