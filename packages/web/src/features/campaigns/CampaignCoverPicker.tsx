import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader, X } from "lucide-react";
import type { Campaign, ImageAttachment } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { Modal } from "../../ui/Modal.js";
import { imageError, useImageDraft } from "../images/useImageDraft.js";
import { ImagePreview } from "../images/ImageViewer.js";
import { DeleteImageButton } from "../images/DeleteImageButton.js";
import { isImageDeleted, useDeletedImageIds, useImageDeletion } from "../images/image-deletions.js";
import { lockImageScroll } from "../images/scroll-lock.js";
import "./CampaignCoverPicker.css";

interface Props { campaign: Campaign; onChange: (campaign: Campaign) => void; onClose: () => void }
// Новый ключ изолирует незавершённые чтения файлов и запросы предыдущей кампании.
export function CampaignCoverPicker(props: Props) { return <CoverPicker key={props.campaign.id} {...props} />; }

function CoverPicker({ campaign, onChange, onClose }: Props) {
  const [allImages, setImages] = useState<ImageAttachment[]>([]);
  const deleted = useDeletedImageIds();
  const images = allImages.filter((image) => !deleted.has(image.id));
  const [selectedId, setSelectedId] = useState<string | null>(campaign.cover?.id ?? null);
  const [loading, setLoading] = useState(true);
  const [galleryError, setGalleryError] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const active = useRef(true);
  const busy = useRef(false);
  const galleryVersion = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const draft = useImageDraft(campaign.id);
  const close = useCallback(() => { if (!busy.current) onClose(); }, [onClose]);
  useImageDeletion((id) => {
    setImages((current) => current.filter((image) => image.id !== id));
    setSelectedId((current) => current === id ? null : current);
    if (campaign.cover?.id === id) onChange({ ...campaign, cover: null });
    void loadImages();
  });

  async function loadImages() {
    const version = ++galleryVersion.current;
    setLoading(true); setGalleryError("");
    try {
      const result = await api.campaignImages(campaign.id);
      if (active.current && galleryVersion.current === version) setImages(result);
    } catch (e) { if (active.current && galleryVersion.current === version) setGalleryError(imageError(e)); }
    finally { if (active.current && galleryVersion.current === version) setLoading(false); }
  }
  useEffect(() => {
    active.current = true;
    void loadImages();
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockImageScroll();
    closeButton.current?.focus({ preventScroll: true });
    function keepFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || document.querySelector(".image-viewer, [data-image-delete-dialog]")) return;
      const controls = content.current?.closest("[role=dialog]")?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      const outside = !content.current?.closest("[role=dialog]")?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", keepFocus);
    return () => {
      active.current = false;
      galleryVersion.current++;
      window.removeEventListener("keydown", keepFocus);
      unlock();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  // Кампания монтируется с новым ключом; ответы проверяют active и версию галереи.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(clear = false) {
    if (busy.current || (!clear && (draft.reading || (!draft.items.length && !selectedId)))) return;
    busy.current = true; setWorking(true); setError("");
    try {
      let imageId = clear ? null : selectedId;
      if (!clear && draft.items.length) {
        const uploaded = await draft.upload(campaign.id);
        if (!active.current || !draft.isCurrent()) return;
        imageId = uploaded[0].id;
      }
      const updated = await api.setCampaignCover(campaign.id, imageId);
      if (!active.current) return;
      onChange(updated.cover && isImageDeleted(updated.cover.id) ? { ...updated, cover: null } : updated);
      onClose();
    } catch (e) { if (active.current) setError(imageError(e)); }
    finally { if (active.current) { busy.current = false; setWorking(false); } }
  }

  const pending = draft.items[0];
  const canSave = !working && !draft.reading && (pending || (selectedId && selectedId !== campaign.cover?.id));
  return <Modal title="Обложка кампании" onClose={close} className="campaign-cover-picker">
    <div ref={content}>
      <button ref={closeButton} type="button" className="btn-ghost cover-picker-close" aria-label="Закрыть выбор обложки" disabled={working} onClick={close}><X size={19} /></button>
      <p className="cover-picker-campaign">{campaign.name}</p>
      <p className="cover-picker-intro">Выберите изображение из этой кампании или загрузите новое.</p>
      <div className="cover-picker-section-title"><h4>Изображения кампании</h4>{images.length > 0 && <span>{images.length}</span>}</div>
      {loading ? <p className="cover-picker-state" role="status">Загружаем изображения…</p>
        : galleryError ? <div className="cover-picker-state"><p className="image-error" role="alert">{galleryError}</p><button type="button" className="btn-ghost" disabled={working} onClick={() => { void loadImages(); }}>Повторить загрузку</button></div>
        : images.length === 0 ? <p className="cover-picker-state">В этой кампании пока нет изображений. Загрузите первую обложку.</p>
        : <ul className="cover-picker-gallery" aria-label="Изображения кампании">{images.map((image, index) => {
          const selected = !pending && image.id === selectedId;
          return <li key={image.id} className={selected ? "is-selected" : undefined}>
            <ImagePreview images={images} index={index} className="cover-picker-preview" />
            <div className="cover-picker-controls"><button type="button" className="cover-picker-choice" disabled={working} aria-label={selected ? `Выбрано: ${image.name}` : `Выбрать ${image.name}`} aria-pressed={selected} onClick={() => { draft.clear(); setSelectedId(image.id); setError(""); }}><span title={image.name}>{image.name}</span><span className="cover-picker-check" aria-hidden="true">{selected && <Check size={13} />}</span></button><DeleteImageButton image={image} disabled={working} /></div>
          </li>;
        })}</ul>}
      <div className="cover-picker-upload">
        {pending && <div className="cover-picker-draft">{pending.dataUrl ? <img src={pending.dataUrl} alt={`Новая обложка: ${pending.name}`} /> : <span>Читаем файл…</span>}<span title={pending.name}>{pending.name}</span><button type="button" className="btn-ghost" disabled={working} aria-label="Убрать новый файл" onClick={() => draft.clear()}><X size={15} /></button></div>}
        <button type="button" className="btn-ghost cover-picker-upload-button" disabled={working} onClick={() => fileInput.current?.click()}><ImagePlus size={16} />{pending ? "Выбрать другой файл" : "Загрузить изображение"}</button>
        <span className="cover-picker-upload-hint">PNG, JPEG или WebP · до 10 МБ</span>
        <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Загрузить обложку" disabled={working} onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) { draft.clear(); draft.addFiles([file]); setError(""); }
          event.target.value = "";
        }} />
      </div>
      {(error || draft.error) && <p className="image-error" role="alert">{error || draft.error}</p>}
      <div className="cover-picker-actions">
        {campaign.cover && <button type="button" className="btn-ghost cover-picker-clear" disabled={working} onClick={() => { void save(true); }}>Убрать обложку</button>}
        <button type="button" disabled={!canSave} onClick={() => { void save(); }}>{working ? <><Loader size={14} className="spin" /> Сохраняю…</> : "Сохранить обложку"}</button>
      </div>
    </div>
  </Modal>;
}
