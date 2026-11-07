import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ImagePlus, TriangleAlert } from "lucide-react";
import { getDocumentType, type Document, type ImageAttachment, type WorkshopImageAttachmentResult } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { Modal } from "../../ui/Modal.js";
import { MessageImages } from "../images/ImageAttachments.js";
import { imageError } from "../images/useImageDraft.js";

export function WorkshopImageResults({ campaignId, results }: { campaignId: string; results?: WorkshopImageAttachmentResult[] }) {
  if (!results?.length) return null;
  return <ul className="workshop-image-results" aria-label="Результаты прикрепления изображений">
    {results.map((result, index) => {
      const image = result.error ? undefined : result.image;
      return <li key={`${result.documentId}-${image?.id ?? index}`} className={image ? "workshop-image-result" : "workshop-image-result workshop-image-result-error"}>
        {image && <a className="workshop-image-preview" href={`/api/images/${image.id}`} target="_blank" rel="noopener noreferrer" title={`Открыть ${image.name}`}>
          <img src={`/api/images/${image.id}`} alt={image.name} loading="lazy" />
        </a>}
        <div className="workshop-image-result-body">
          <span className="workshop-image-status">{image ? <><Check size={13} /> Прикреплено</> : <><TriangleAlert size={13} /> Не прикреплено</>}</span>
          <Link to={`/campaigns/${campaignId}/documents/${result.documentId}`}>{result.documentTitle || result.documentId}</Link>
          {!image && <p className="image-error">{result.error || "Сервер не подтвердил прикрепление изображения"}</p>}
        </div>
      </li>;
    })}
  </ul>;
}

interface MessageImagesProps { campaignId: string; images?: ImageAttachment[] }

// При смене кампании сбрасываем открытый выбор и локальные подтверждения.
export function WorkshopMessageImages(props: MessageImagesProps) {
  return <WorkshopMessageImagesContent key={props.campaignId} {...props} />;
}

function WorkshopMessageImagesContent({ campaignId, images }: MessageImagesProps) {
  const [selected, setSelected] = useState<ImageAttachment | null>(null);
  const [attached, setAttached] = useState<WorkshopImageAttachmentResult[]>([]);
  if (!images?.length) return null;
  return <>
    <div className="workshop-message-images">
      {images.map((image) => <div key={image.id} className="workshop-message-image">
        <MessageImages images={[image]} />
        <button type="button" className="btn-ghost" aria-label={`Прикрепить ${image.name} к сущности`} onClick={() => setSelected(image)}>
          <ImagePlus size={13} /> К сущности
        </button>
      </div>)}
    </div>
    <WorkshopImageResults campaignId={campaignId} results={attached} />
    {selected && <ImageTargetPicker key={selected.id} campaignId={campaignId} image={selected} onClose={() => setSelected(null)} onAttached={(result) => {
      setAttached((previous) => [...previous.filter((item) => item.documentId !== result.documentId || item.image?.id !== result.image?.id), result]);
      setSelected(null);
    }} />}
  </>;
}

function ImageTargetPicker({ campaignId, image, onClose, onAttached }: {
  campaignId: string;
  image: ImageAttachment;
  onClose: () => void;
  onAttached: (result: WorkshopImageAttachmentResult) => void;
}) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentId, setDocumentId] = useState("");
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
      onAttached({ documentId: target.id, documentTitle: target.title, image: confirmed });
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
