import { useEffect, useId, useMemo, useState } from "react";
import { Image, Monitor, RefreshCw, X } from "lucide-react";
import { getDocumentType, type Document, type ImageAttachment } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { ImagePreview } from "../images/ImageViewer.js";
import { imageError } from "../images/useImageDraft.js";
import "./PlayImages.css";

export interface PlayerImageScreen {
  image: ImageAttachment | null;
  captionVisible: boolean;
  error: string;
  show: (image: ImageAttachment, captionVisible?: boolean) => void;
  clear: () => void;
}
interface Props {
  campaignId: string;
  documents: Document[];
  session: Document;
  initialDocumentId?: string;
  playerScreen: PlayerImageScreen;
}
interface GalleryState {
  documentId: string;
  images: ImageAttachment[];
  loading: boolean;
  error: string;
}

// Смена сессии изолирует выбор, подпись и незавершённые запросы галереи.
export function PlayImages(props: Props) {
  return <EntityImages key={`${props.campaignId}:${props.session.id}`} {...props} />;
}

function EntityImages({ campaignId, documents, session, initialDocumentId, playerScreen }: Props) {
  const selectorId = useId();
  const captionId = useId();
  const entities = useMemo(() => {
    const byId = new Map(documents.filter((doc) => doc.campaignId === campaignId).map((doc) => [doc.id, doc]));
    if (session.campaignId === campaignId) byId.set(session.id, session);
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }, [campaignId, documents, session]);
  const [chosenId, setChosenId] = useState(initialDocumentId ?? session.id);
  const selectedId = entities.some((entity) => entity.id === chosenId) ? chosenId : session.id;
  const [captionVisible, setCaptionVisible] = useState(playerScreen.captionVisible);
  useEffect(() => { setCaptionVisible(playerScreen.captionVisible); }, [playerScreen.captionVisible]);
  const [reload, setReload] = useState(0);
  const [gallery, setGallery] = useState<GalleryState>({ documentId: selectedId, images: [], loading: true, error: "" });

  useEffect(() => {
    let current = true;
    setGallery({ documentId: selectedId, images: [], loading: true, error: "" });
    api.documentImages(selectedId).then((images) => {
      if (current) setGallery({ documentId: selectedId, images, loading: false, error: "" });
    }).catch((error: unknown) => {
      if (current) setGallery({ documentId: selectedId, images: [], loading: false, error: imageError(error) });
    });
    return () => { current = false; };
  }, [selectedId, reload]);

  const loading = gallery.loading || gallery.documentId !== selectedId;
  const images = gallery.documentId === selectedId ? gallery.images : [];
  const error = gallery.documentId === selectedId ? gallery.error : "";

  return <section className="play-images" aria-label="Изображения для игры">
    <div className="play-images-intro">
      <div><Image size={17} strokeWidth={1.6} /><h2>Изображения</h2></div>
      <p>Откройте картинку для себя или покажите её на экране игроков.</p>
    </div>

    {playerScreen.image && <div className="play-images-current" role="status">
      <img src={`/api/images/${playerScreen.image.id}`} alt="" />
      <div><span><Monitor size={11} /> {playerScreen.error ? "Выбрано для показа" : "На экране игроков"}</span><strong title={playerScreen.image.name}>{playerScreen.image.name}</strong></div>
      <button type="button" className="btn-ghost" title="Скрыть изображение" aria-label="Скрыть изображение" onClick={() => { playerScreen.clear(); setCaptionVisible(false); }}><X size={15} /></button>
    </div>}
    {playerScreen.error && <p className="play-images-error" role="alert">{playerScreen.error}</p>}

    <div className="play-images-selector">
      <label htmlFor={selectorId}>Изображения сущности</label>
      <select id={selectorId} value={selectedId} onChange={(event) => setChosenId(event.target.value)}>
        {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.title} · {getDocumentType(entity.type)?.label ?? entity.type}</option>)}
      </select>
    </div>
    <label className="play-images-caption" htmlFor={captionId}>
      <input id={captionId} type="checkbox" checked={captionVisible} onChange={(event) => {
        const visible = event.target.checked;
        setCaptionVisible(visible);
        if (playerScreen.image) playerScreen.show(playerScreen.image, visible);
      }} />
      <span>Показывать название изображения игрокам</span>
    </label>

    {loading ? <div className="play-images-empty" role="status"><Image size={24} strokeWidth={1.2} /><p>Загружаем изображения…</p></div>
      : error ? <div className="play-images-empty"><p className="play-images-error" role="alert">{error}</p><button type="button" className="btn-ghost" aria-label="Повторить загрузку изображений" onClick={() => setReload((value) => value + 1)}><RefreshCw size={13} /> Повторить загрузку</button></div>
      : images.length === 0 ? <div className="play-images-empty"><Image size={27} strokeWidth={1.2} /><h3>У этой сущности пока нет изображений</h3><p>Добавьте их на странице сущности, затем вернитесь к игре.</p><button type="button" className="btn-ghost" aria-label="Повторить загрузку изображений" onClick={() => setReload((value) => value + 1)}><RefreshCw size={13} /> Обновить</button></div>
      : <ul className="play-images-gallery" aria-label="Галерея сущности">{images.map((image, index) => <li key={image.id} className={playerScreen.image?.id === image.id && !playerScreen.error ? "is-shown" : undefined}>
        <ImagePreview images={images} index={index} className="play-image-preview" />
        <div className="play-image-details"><span className="play-image-name" title={image.name}>{image.name}</span><button type="button" className="btn-ghost play-image-show" aria-label={`Показать игрокам ${image.name}`} onClick={() => playerScreen.show(image, captionVisible)}><Monitor size={12} /> {playerScreen.image?.id === image.id && !playerScreen.error ? "Показывается" : "Показать игрокам"}</button></div>
      </li>)}</ul>}
  </section>;
}
