import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Image, Search, X } from "lucide-react";
import { getDocumentType, type Document, type ImageAttachment } from "@master-ai/shared";
import { Modal } from "../../ui/Modal.js";
import { TypeBadge, typeColors } from "../campaigns/shared.js";
import "./EntityImagePicker.css";

interface Props {
  entities: Document[];
  selected: Document;
  preview?: ImageAttachment;
  onSelect: (id: string) => void;
}

export function EntityImagePicker({ entities, selected, preview, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const thumbnail = selected.avatar ?? preview;
  return <div className="play-images-selector">
    <span className="play-images-selector-label">Изображения сущности</span>
    <button type="button" className="entity-image-trigger" aria-label={`Выбрать сущность: ${selected.title}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className="entity-image-trigger-preview">{thumbnail ? <img src={`/api/images/${thumbnail.id}`} alt="" /> : <TypeBadge type={selected.type} size={32} />}</span>
      <span className="entity-image-trigger-copy"><span className="entity-image-type-label"><TypeBadge type={selected.type} size={18} />{getDocumentType(selected.type)?.label ?? selected.type}</span><strong title={selected.title}>{selected.title}</strong><span className="entity-image-trigger-hint">Выбрать другую сущность</span></span>
      <ChevronRight size={17} strokeWidth={1.5} />
    </button>
    {open && <PickerDialog entities={entities} selectedId={selected.id} onClose={() => setOpen(false)} onSelect={(id) => { onSelect(id); setOpen(false); }} />}
  </div>;
}

function PickerDialog({ entities, selectedId, onClose, onSelect }: {
  entities: Document[];
  selectedId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [withImages, setWithImages] = useState(true);
  const search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const picturedCount = entities.filter((entity) => entity.avatar).length;
  const types = useMemo(() => [...new Set(entities.map((entity) => entity.type))].sort((a, b) =>
    (getDocumentType(a)?.label ?? a).localeCompare(getDocumentType(b)?.label ?? b, "ru")), [entities]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filtered = entities.filter((entity) => {
    const label = getDocumentType(entity.type)?.label ?? entity.type;
    return (!withImages || entity.avatar) && (!type || entity.type === type)
      && `${entity.title} ${label} ${entity.type}`.toLocaleLowerCase("ru").includes(normalizedQuery);
  });
  const reset = () => { setQuery(""); setType(""); search.current?.focus(); };

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    search.current?.focus({ preventScroll: true });
    function keepFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const dialog = content.current?.closest("[role=dialog]");
      const controls = dialog?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      const outside = !dialog?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", keepFocus);
    return () => {
      window.removeEventListener("keydown", keepFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<div className="entity-image-picker-layer"><Modal title="Изображения сущностей" onClose={onClose} className="entity-image-picker">
    <div ref={content} className="entity-image-picker-content">
      <button type="button" className="entity-image-picker-close btn-ghost" aria-label="Закрыть выбор сущности" onClick={onClose}><X size={20} /></button>
      <p className="entity-image-picker-intro">Найдите персонажа, место или другую сущность, чтобы открыть её галерею.</p>
      <div className="entity-image-search"><Search size={17} strokeWidth={1.6} /><input ref={search} type="search" aria-label="Поиск сущности" placeholder="Название или тип сущности" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" className="btn-ghost" aria-label="Очистить поиск" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={15} /></button>}</div>
      <div className="entity-image-scope" role="group" aria-label="Наличие изображений">
        <button type="button" aria-pressed={withImages} onClick={() => setWithImages(true)}><Image size={14} />С изображениями <span>{picturedCount}</span></button>
        <button type="button" aria-pressed={!withImages} onClick={() => setWithImages(false)}>Все сущности <span>{entities.length}</span></button>
      </div>
      <div className="entity-image-types" role="group" aria-label="Тип сущности">
        <button type="button" aria-pressed={!type} onClick={() => setType("")}>Все типы</button>
        {types.map((key) => <button key={key} type="button" aria-pressed={type === key} onClick={() => setType(key)} style={type === key ? { color: typeColors(key).fg, borderColor: typeColors(key).fg, background: typeColors(key).bg } : undefined}><TypeBadge type={key} size={24} />{getDocumentType(key)?.label ?? key}</button>)}
      </div>
      <div className="entity-image-results-heading"><span>Галереи</span><span role="status" aria-live="polite">Найдено: {filtered.length}</span></div>
      {filtered.length ? <ul className="entity-image-results" aria-label="Сущности с галереями">{filtered.map((entity) => <li key={entity.id}>
        <button type="button" className="entity-image-choice" aria-label={`Открыть галерею ${entity.title}`} aria-pressed={selectedId === entity.id} onClick={() => onSelect(entity.id)}>
          <span className="entity-image-choice-preview">{entity.avatar ? <img src={`/api/images/${entity.avatar.id}`} alt={entity.title} loading="lazy" /> : <TypeBadge type={entity.type} size={32} />}</span>
          <span className="entity-image-choice-copy"><span className="entity-image-type-label"><TypeBadge type={entity.type} size={18} />{getDocumentType(entity.type)?.label ?? entity.type}</span><strong>{entity.title}</strong>{!entity.avatar && <small>Пока без изображений</small>}</span>
          <span className="entity-image-choice-mark" aria-hidden="true">{selectedId === entity.id ? <Check size={16} /> : <ChevronRight size={15} />}</span>
        </button>
      </li>)}</ul> : <div className="entity-image-picker-empty"><Image size={30} strokeWidth={1} />
        <strong>{withImages && picturedCount === 0 && !normalizedQuery && !type ? "Пока нет сущностей с изображениями" : "Ничего не найдено"}</strong>
        <p>{withImages && picturedCount === 0 ? "Переключитесь на все сущности или добавьте изображения на странице сущности." : "Попробуйте другое название или измените фильтры."}</p>
        {(query || type) && <button type="button" className="btn-ghost" onClick={reset}>Сбросить поиск и фильтры</button>}
      </div>}
      <div className="entity-image-picker-footer"><span>Выбор виден только мастеру</span><span><kbd>Esc</kbd> закрыть</span></div>
    </div>
  </Modal></div>, document.body);
}
