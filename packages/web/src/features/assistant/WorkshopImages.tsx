import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ImagePlus, TriangleAlert } from "lucide-react";
import { getDocumentType, type Document, type ImageAttachment, type WorkshopImageAttachmentResult } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { Modal } from "../../ui/Modal.js";
import { ImagePreview } from "../images/ImageViewer.js";
import { imageError } from "../images/useImageDraft.js";
import "./WorkshopImages.css";

export function WorkshopImageResults({ campaignId, results }: { campaignId: string; results?: WorkshopImageAttachmentResult[] }) {
  if (!results?.length) return null;
  const images = results.flatMap((result) => result.image ? [result.image] : []);
  return <ul className="workshop-image-results" aria-label="Результаты прикрепления изображений">
    {results.map((result, index) => {
      const image = result.image;
      return <li key={`${result.documentId}-${image?.id ?? index}`} className={image ? "workshop-image-result" : "workshop-image-result workshop-image-result-error"}>
        {image && <ImagePreview className="workshop-image-preview" images={images} index={images.findIndex((item) => item.id === image.id)} />}
        <div className="workshop-image-result-body">
          <span className="workshop-image-status">{image ? <><Check size={13} /> {result.isAvatar ? "Главное изображение" : "Прикреплено"}</> : <><TriangleAlert size={13} /> Не прикреплено</>}</span>
          {image && <span className="workshop-image-caption" title={image.name}>{image.name.replace(/\.(?:png|jpe?g|webp)$/i, "")}</span>}
          <Link to={`/campaigns/${campaignId}/documents/${result.documentId}`}>Карточка: {result.documentTitle || result.documentId}</Link>
          {(result.error || !image) && <p className="image-error">{result.error || "Сервер не подтвердил прикрепление изображения"}</p>}
        </div>
      </li>;
    })}
  </ul>;
}

interface MessageImagesProps { campaignId: string; images?: ImageAttachment[]; defaultDocumentId?: string; onImagesChange?: () => void }

// При смене кампании сбрасываем открытый выбор и локальные подтверждения.
export function WorkshopMessageImages(props: MessageImagesProps) {
  return <WorkshopMessageImagesContent key={`${props.campaignId}:${props.defaultDocumentId ?? ""}`} {...props} />;
}

function WorkshopMessageImagesContent({ campaignId, images, defaultDocumentId, onImagesChange }: MessageImagesProps) {
  const [selected, setSelected] = useState<ImageAttachment | null>(null);
  const [attached, setAttached] = useState<WorkshopImageAttachmentResult[]>([]);
  if (!images?.length) return null;
  return <>
    <div className="workshop-message-images">
      {images.map((image, index) => <div key={image.id} className="workshop-message-image">
        <div className="message-images"><ImagePreview images={images} index={index} /></div>
        <button type="button" className="btn-ghost" aria-label={`Прикрепить ${image.name} к сущности`} onClick={() => setSelected(image)}>
          <ImagePlus size={13} /> К сущности
        </button>
      </div>)}
    </div>
    <WorkshopImageResults campaignId={campaignId} results={attached} />
    {selected && <ImageTargetPicker key={selected.id} campaignId={campaignId} image={selected} defaultDocumentId={defaultDocumentId} onClose={() => setSelected(null)} onAttached={(result) => {
      setAttached((previous) => [...previous.filter((item) => item.documentId !== result.documentId || item.image?.id !== result.image?.id), result]);
      setSelected(null);
      onImagesChange?.();
    }} />}
  </>;
}

function ImageTargetPicker({ campaignId, image, defaultDocumentId, onClose, onAttached }: {
  campaignId: string;
  image: ImageAttachment;
  defaultDocumentId?: string;
  onClose: () => void;
  onAttached: (result: WorkshopImageAttachmentResult) => void;
}) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentId, setDocumentId] = useState(defaultDocumentId ?? "");
  const [setAsAvatar, setAvatarChoice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const selectId = useId();
  const active = useRef(true);
  const actionBusy = useRef(false);

  useEffect(() => {
    let current = true;
    active.current = true;
    api.listCampaignDocuments(campaignId)
      .then((result) => { if (current) setDocuments(result.filter((document) => document.campaignId === campaignId)); })
      .catch((reason) => { if (current) setError(imageError(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; active.current = false; };
  }, [campaignId]);

  async function attach() {
    const target = documents.find((document) => document.id === documentId);
    if (!target || actionBusy.current) return;
    actionBusy.current = true;
    setWorking(true);
    setError("");
    try {
      const stored = await api.attachDocumentImage(target.id, image.id);
      if (!active.current) return;
      const confirmed = stored.find((item) => item.id === image.id);
      if (!confirmed) throw new Error("Сервер не подтвердил прикрепление изображения");
      if (setAsAvatar) {
        try {
          const updated = await api.setDocumentAvatar(target.id, image.id);
          if (!active.current) return;
          if (updated.avatar?.id !== image.id) throw new Error("Сервер не подтвердил выбор главного изображения");
        } catch (reason) {
          if (active.current) onAttached({ documentId: target.id, documentTitle: target.title, image: confirmed, error: `Изображение прикреплено. ${imageError(reason)}` });
          return;
        }
      }
      onAttached({ documentId: target.id, documentTitle: target.title, image: confirmed, ...(setAsAvatar ? { isAvatar: true } : {}) });
    } catch (reason) {
      if (active.current) setError(imageError(reason));
    } finally {
      if (active.current) { actionBusy.current = false; setWorking(false); }
    }
  }

  return <Modal title="Прикрепить изображение" className="modal-image-target" onClose={onClose}>
    <div className="workshop-image-source">
      <img src={`/api/images/${image.id}`} alt={image.name} />
      <span>{image.name}</span>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void attach(); }}>
      <label htmlFor={selectId}>Сущность</label>
      <select id={selectId} value={documentId} disabled={loading || working || !documents.length} onChange={(event) => setDocumentId(event.target.value)} autoFocus>
        <option value="">Выберите сущность…</option>
        {documents.map((document) => <option key={document.id} value={document.id}>
          {document.title} · {getDocumentType(document.type)?.label ?? document.type}
        </option>)}
      </select>
      <label className="image-target-avatar"><input type="checkbox" checked={setAsAvatar} disabled={working} onChange={(event) => setAvatarChoice(event.target.checked)} /> Сделать главным изображением</label>
      {loading && <p className="muted" role="status">Загрузка сущностей…</p>}
      {!loading && !error && !documents.length && <p className="muted">В кампании пока нет сущностей. Сначала создайте карточку.</p>}
      {error && <p className="image-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="submit" disabled={!documentId || loading || working}>{working ? "Прикрепляю…" : "Прикрепить"}</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
      </div>
    </form>
  </Modal>;
}
