import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader, Sparkles, Square, X } from "lucide-react";
import type { Document, ImageAttachment } from "@master-ai/shared";
import { api, ApiError } from "../../api/client.js";
import { ImageAttachments } from "./ImageAttachments.js";
import { ImagePreview } from "./ImageViewer.js";
import { imageError, useImageDraft } from "./useImageDraft.js";
import "./EntityAvatars.css";

interface Props {
  docId: string;
  campaignId: string;
  title: string;
  typeLabel: string;
  description: string;
  avatar?: ImageAttachment | null;
  selectedAvatarId?: string | null;
  onDocumentChange?: (document: Document) => void;
  onImagesChange?: () => void;
}
// Ключ изолирует галерею, черновик и опрос: ответ старого документа не попадает в новый.
export function DocumentImages(props: Props) { return <DocumentImagesPanel key={props.docId} {...props} />; }

function DocumentImagesPanel({ docId, campaignId, title, typeLabel, description, avatar, selectedAvatarId, onDocumentChange, onImagesChange }: Props) {
  const [avatarId, setAvatarId] = useState(avatar?.id);
  const [explicitAvatarId, setExplicitAvatarId] = useState(selectedAvatarId);
  useEffect(() => { setAvatarId(avatar?.id); }, [avatar?.id]);
  useEffect(() => { setExplicitAvatarId(selectedAvatarId); }, [selectedAvatarId]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusKnown, setStatusKnown] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState(() => `Создай иллюстрацию для сущности «${title}» (${typeLabel}).\n${description.slice(0, 8000)}`.trim());
  const promptId = useId();
  const draft = useImageDraft(docId);
  const active = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pollVersion = useRef(0);
  const galleryVersion = useRef(0);
  const actionBusy = useRef(false);
  const generationBusy = useRef(false);

  async function refreshGallery() {
    const version = ++galleryVersion.current;
    try {
      const result = await api.documentImages(docId);
      if (active.current && galleryVersion.current === version) setImages(result);
    } catch (e) {
      if (active.current && galleryVersion.current === version) setError(imageError(e));
    } finally {
      if (active.current && galleryVersion.current === version) setLoading(false);
    }
  }
  async function poll(version: number) {
    try {
      const status = await api.imageGenerationStatus(docId);
      if (!active.current || pollVersion.current !== version) return;
      setStatusKnown(true);
      setStatusError("");
      setRunning(status.running);
      if (status.error) setError(status.error);
      if (status.running) timer.current = setTimeout(() => { void poll(version); }, 1200);
      else if (status.image) { setNotice("Иллюстрация прикреплена"); await refreshGallery(); if (active.current) onImagesChange?.(); }
    } catch (e) {
      if (!active.current || pollVersion.current !== version) return;
      // Ошибка связи не означает, что серверная задача закончилась.
      // Сохраняем последний статус и повторяем опрос; первый неизвестный статус
      // блокирует новый запуск, пока не выясним, нет ли уже идущей генерации.
      setStatusError(imageError(e));
      timer.current = setTimeout(() => { void poll(version); }, 1200);
    }
  }
  useEffect(() => {
    active.current = true;
    void refreshGallery();
    void poll(++pollVersion.current);
    return () => { active.current = false; pollVersion.current++; if (timer.current) clearTimeout(timer.current); };
  // Каждая сущность монтируется с новым ключом.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function attach() {
    if (actionBusy.current || draft.reading || !draft.items.length) return;
    actionBusy.current = true;
    setWorking(true); setError(""); setNotice("");
    try {
      const uploaded = await draft.upload(campaignId);
      if (!active.current) return;
      for (const image of uploaded) {
        const result = await api.attachDocumentImage(docId, image.id);
        if (!active.current) return;
        galleryVersion.current++;
        setImages(result);
        onImagesChange?.();
        const item = draft.items.find((i) => i.uploaded?.id === image.id || i.name === image.name);
        if (item) draft.remove(item.key);
      }
      draft.clear(); setNotice("Изображения прикреплены");
    } catch (e) { if (active.current) setError(imageError(e)); }
    finally { if (active.current) { actionBusy.current = false; setWorking(false); } }
  }
  async function detach(image: ImageAttachment) {
    if (actionBusy.current) return;
    actionBusy.current = true; setWorking(true); setError(""); setNotice("");
    try {
      const result = await api.detachDocumentImage(docId, image.id);
      if (!active.current) return;
      galleryVersion.current++; setImages(result); setNotice("Изображение откреплено");
      onImagesChange?.();
    } catch (e) { if (active.current) setError(imageError(e)); }
    finally { if (active.current) { actionBusy.current = false; setWorking(false); } }
  }
  async function chooseAvatar(imageId: string | null) {
    if (actionBusy.current) return;
    actionBusy.current = true; setWorking(true); setError(""); setNotice("");
    try {
      const updated = await api.setDocumentAvatar(docId, imageId);
      if (!active.current) return;
      setAvatarId(updated.avatar?.id);
      setExplicitAvatarId(typeof updated.fields?.avatarImageId === "string" ? updated.fields.avatarImageId : null);
      onDocumentChange?.(updated);
      setNotice(imageId ? "Аватар выбран" : "Аватар — первое изображение галереи");
    } catch (e) { if (active.current) setError(imageError(e)); }
    finally { if (active.current) { actionBusy.current = false; setWorking(false); } }
  }
  async function generate() {
    if (generationBusy.current || running || !statusKnown || !prompt.trim()) return;
    generationBusy.current = true;
    const version = ++pollVersion.current;
    if (timer.current) clearTimeout(timer.current);
    setRunning(true); setError(""); setNotice("");
    try {
      await api.startImageGeneration(docId, prompt.trim());
      if (!active.current || pollVersion.current !== version) return;
      await poll(version);
    } catch (e) {
      if (!active.current || pollVersion.current !== version) return;
      if (e instanceof ApiError && e.status === 409) {
        // Другой клиент уже запустил задачу: подхватываем её, сохраняя «Стоп».
        await poll(version);
      } else { setRunning(false); setError(imageError(e)); }
    } finally { generationBusy.current = false; }
  }
  async function stop() {
    setError("");
    const version = ++pollVersion.current;
    if (timer.current) clearTimeout(timer.current);
    try {
      await api.stopImageGeneration(docId);
      if (!active.current || pollVersion.current !== version) return;
      setRunning(false); setStatusKnown(true); setStatusError(""); setNotice("Генерация остановлена");
    } catch (e) {
      if (!active.current || pollVersion.current !== version) return;
      setError(imageError(e));
      timer.current = setTimeout(() => { void poll(version); }, 1200);
    }
  }
  const activeAvatarId = images.some((image) => image.id === avatarId) ? avatarId : images[0]?.id;
  return <section className="document-images" aria-label="Изображения сущности">
    <div className="entity-image-heading"><h3>Изображения</h3><span className="muted">{images.length > 0 ? images.length : ""}</span></div>
    {loading ? <p className="muted">Загрузка изображений…</p> : images.length === 0 ? <p className="muted image-empty">Добавьте портрет, карту или референс.</p> : <ul className="entity-image-gallery">
      {images.map((image, index) => <li key={image.id} className={image.id === activeAvatarId ? "is-avatar" : undefined}>
        <ImagePreview images={images} index={index} className="entity-image-preview" />
        <div className="entity-image-caption"><span title={image.name}>{image.name}</span><button type="button" className="btn-ghost" disabled={working} aria-label={`Открепить ${image.name}`} onClick={() => { void detach(image); }} title="Открепить от сущности"><X size={14} /></button></div>
        <button type="button" className="entity-avatar-choice btn-ghost" disabled={working || image.id === activeAvatarId} aria-label={image.id === activeAvatarId ? `Аватар: ${image.name}` : `Сделать аватаром ${image.name}`} aria-pressed={image.id === activeAvatarId} onClick={() => { void chooseAvatar(image.id); }}>
          {image.id === activeAvatarId && <Check size={12} />} {image.id === activeAvatarId ? "Аватар" : "Сделать аватаром"}
        </button>
      </li>)}
    </ul>}
    {images.length > 0 && explicitAvatarId && <button type="button" className="btn-ghost entity-avatar-reset" disabled={working} onClick={() => { void chooseAvatar(null); }}>Использовать первое изображение</button>}
    <div className="image-paste-target" role="textbox" aria-label="Вставка изображений" aria-multiline="false" tabIndex={0} onPaste={working ? undefined : draft.onPaste}>Нажмите здесь и вставьте изображение ⌘V / Ctrl+V</div>
    <ImageAttachments draft={draft} disabled={working} />
    {draft.items.length > 0 && <button type="button" className="entity-image-attach" disabled={draft.reading || working} onClick={() => { void attach(); }}>{working ? "Прикрепляю…" : "Прикрепить к сущности"}</button>}
    <div className="image-generation">
      <label htmlFor={promptId}>Описание иллюстрации</label>
      <textarea id={promptId} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={running} />
      <p className="muted image-generation-hint">Создание через текущий Codex. Результат появится в галерее.</p>
      {!statusKnown && <p className="muted image-generation-hint" role="status">Проверяю статус генерации…</p>}
      {running ? <div className="image-generation-actions"><span role="status"><Loader size={14} className="spin" /> Создаю иллюстрацию…</span><button type="button" className="btn-ghost" onClick={() => { void stop(); }} aria-label="Остановить иллюстрацию"><Square size={12} /> Стоп</button></div>
        : <button type="button" className="btn-ghost" disabled={!statusKnown || !prompt.trim()} onClick={() => { void generate(); }}><Sparkles size={14} /> Создать иллюстрацию</button>}
    </div>
    {(error || statusError) && <p className="image-error" role="alert">{error || statusError}</p>}
    {notice && <p className="image-notice" role="status">{notice}</p>}
  </section>;
}
