import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  User, Shield, MapPin, Users, Lock, Clapperboard, Calendar, Package, Book, Library, File,
  Swords, Milestone, Replace, LayoutGrid, List, Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType, getDisposition, hasDisposition, statusLabel, statusColor, type Campaign, type Document } from "@master-ai/shared";
import { pmText } from "../../lib/prosemirror-text.js";
import { ThumbnailImage } from "../images/ThumbnailImage.js";
import "../images/EntityAvatars.css";

// Деление типов документов на разделы — как в Campaign Arks.
export const KNOWLEDGE_TYPES = ["pc", "npc", "location", "faction", "lore", "reference", "note"];
export const PLAY_TYPES = ["scene", "encounter", "arc", "session", "secret", "item"];

export interface CampaignContext {
  campaignId: string;
  campaign: Campaign | null;
  documents: Document[];
  reload: () => void;
  reloadCampaign: () => void;
  createDocument: (type: string) => void;
}

export function useCampaign(): CampaignContext {
  return useOutletContext<CampaignContext>();
}

const ICONS: Record<string, LucideIcon> = {
  user: User,
  shield: Shield,
  "map-pin": MapPin,
  users: Users,
  lock: Lock,
  clapperboard: Clapperboard,
  calendar: Calendar,
  package: Package,
  book: Book,
  library: Library,
  file: File,
  swords: Swords,
  milestone: Milestone,
};

// Цвет иконки (fg) + фон плитки (bg) для каждого типа.
const TYPE_COLORS: Record<string, { fg: string; bg: string }> = {
  pc: { fg: "#a3e635", bg: "#1a2e05" },
  npc: { fg: "#34d399", bg: "#0e2a20" },
  location: { fg: "#f59e0b", bg: "#2a1e06" },
  faction: { fg: "#c084fc", bg: "#221036" },
  secret: { fg: "#fb7185", bg: "#2a0f17" },
  scene: { fg: "#38bdf8", bg: "#06283b" },
  encounter: { fg: "#f87171", bg: "#2d0a0a" },
  arc: { fg: "#f0abfc", bg: "#2e1065" },
  session: { fg: "#818cf8", bg: "#14173a" },
  item: { fg: "#fb923c", bg: "#2a1608" },
  lore: { fg: "#2dd4bf", bg: "#07292a" },
  reference: { fg: "#93b4d8", bg: "#131c2b" },
  note: { fg: "#94a3b8", bg: "#1b2433" },
};

function DocIcon({ name, size }: { name: string; size: number }) {
  const Cmp = ICONS[name] ?? File;
  return <Cmp size={size} strokeWidth={1.8} />;
}

// Акцентный цвет типа — для подсветки заголовков/полос на странице документа.
export function typeColor(type: string): string {
  return TYPE_COLORS[type]?.fg ?? "var(--accent)";
}

// Пара цветов типа (текст + фон) — для вертикальной «корешковой» подписи типа.
export function typeColors(type: string): { fg: string; bg: string } {
  return TYPE_COLORS[type] ?? { fg: "var(--muted)", bg: "var(--surface-3)" };
}

export function TypeBadge({ type, size = 40 }: { type: string; size?: number }) {
  const t = getDocumentType(type);
  const c = TYPE_COLORS[type] ?? { fg: "var(--muted)", bg: "var(--surface-3)" };
  return (
    <span
      className="type-tile"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), color: c.fg, background: c.bg }}
    >
      <DocIcon name={t?.icon ?? "file"} size={Math.round(size * 0.5)} />
    </span>
  );
}

// Компактный тег типа: цвет + иконка + русская подпись (для карточек-предложений).
export function TypeTag({ type }: { type: string }) {
  const t = getDocumentType(type);
  const c = TYPE_COLORS[type] ?? { fg: "var(--muted)", bg: "var(--surface-3)" };
  return (
    <span className="type-tag" style={{ color: c.fg, background: c.bg }}>
      <DocIcon name={t?.icon ?? "file"} size={13} />
      {t?.label ?? type}
    </span>
  );
}

const clip = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

// Краткое описание документа для карточки: первое заполненное поле шаблона
// («Метка: значение») или первый содержательный абзац; заголовки разделов и
// пустые поля пропускаем. Работает по структуре ProseMirror, а не по markdown.
export function docSnippet(content: unknown): string {
  const node = content as { content?: unknown[]; type?: string } | null;
  const nodes = node && Array.isArray(node.content) ? node.content : null;
  if (!nodes) return "";
  for (const raw of nodes) {
    const n = raw as { type?: string };
    if (n.type === "heading") continue; // заголовок раздела шаблона
    if (n.type === "bulletList" || n.type === "orderedList" || n.type === "listItem") {
      const inner = docSnippet(raw); // спускаемся в пункты списка
      if (inner) return inner;
      continue;
    }
    const text = pmText(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const colon = text.indexOf(":");
    if (colon >= 0 && colon <= 40) {
      const value = text.slice(colon + 1).trim();
      if (value) return clip(value); // заполненное поле
      continue; // «Метка:» без значения — пропускаем
    }
    return clip(text); // обычный абзац
  }
  return "";
}

// Цветные чипы статуса и отношения — для быстрого сканирования карточек.
function DocChips({ doc }: { doc: Document }) {
  const chips: { label: string; color: string }[] = [];
  const disp = hasDisposition(doc.type) ? getDisposition(String(doc.fields?.disposition ?? "")) : undefined;
  if (disp) chips.push({ label: disp.label, color: disp.color });
  if (doc.status) chips.push({ label: statusLabel(doc.status), color: statusColor(doc.status) });
  if (!chips.length) return null;
  return (
    <span className="doc-chips">
      {chips.map((c) => (
        <span key={c.label} className="doc-chip" style={{ color: c.color }}>
          <span className="doc-chip-dot" style={{ background: c.color }} />{c.label}
        </span>
      ))}
    </span>
  );
}

function CardAvatar({ doc, size }: { doc: Document; size: number }) {
  return doc.avatar
    ? <ThumbnailImage className="entity-card-avatar" imageId={doc.avatar.id} size={128} alt="" style={{ width: size, height: size }} />
    : <TypeBadge type={doc.type} size={size} />;
}

export function DocCard({ doc, variant = "row" }: { doc: Document; variant?: "row" | "tile" }) {
  const t = getDocumentType(doc.type);
  const snippet = docSnippet(doc.contentJson);
  if (variant === "tile") {
    return (
      <Link to={`/campaigns/${doc.campaignId}/documents/${doc.id}`} className="doc-tile">
        <CardAvatar doc={doc} size={64} />
        <span className="doc-tile-title">{doc.title}</span>
        {snippet && <span className="doc-tile-snippet">{snippet}</span>}
        <DocChips doc={doc} />
      </Link>
    );
  }
  return (
    <Link to={`/campaigns/${doc.campaignId}/documents/${doc.id}`} className="doc-card">
      <CardAvatar doc={doc} size={40} />
      <span className="doc-card-body">
        <span className="doc-card-title">{doc.title}</span>
        {snippet
          ? <span className="doc-card-snippet">{snippet}</span>
          : <span className="doc-card-type">{t?.label ?? doc.type}</span>}
        <DocChips doc={doc} />
      </span>
    </Link>
  );
}

export function RecentlyCreated({ documents }: { documents: Document[] }) {
  const recent = [...documents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  return (
    <aside className="panel">
      <h3>Недавно созданные</h3>
      {recent.length === 0 ? (
        <p className="muted">Пока нет документов.</p>
      ) : (
        <ul className="doc-cards">
          {recent.map((d) => <li key={d.id}><DocCard doc={d} /></li>)}
        </ul>
      )}
    </aside>
  );
}

export type ViewMode = "grid" | "list";

// Раздел документов одного типа: заголовок с цветной иконкой + счётчик + карточки.
export function TypeSection({ type, documents, view = "grid" }: { type: string; documents: Document[]; view?: ViewMode }) {
  const t = getDocumentType(type);
  const docs = documents.filter((d) => d.type === type);
  if (docs.length === 0) return null;
  return (
    <section className="type-section">
      <div className="type-section-head">
        <TypeBadge type={type} size={24} />
        <h2>{t?.label ?? type}</h2>
        <span className="count-badge">{docs.length}</span>
      </div>
      <ul className={view === "grid" ? "doc-cards grid" : "doc-cards"}>
        {docs.map((d) => <li key={d.id}><DocCard doc={d} variant={view === "grid" ? "tile" : "row"} /></li>)}
      </ul>
    </section>
  );
}

// Переключатель вида: сеткой / списком.
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Вид">
      <button type="button" className={view === "grid" ? "active" : ""} aria-label="Сеткой" title="Сеткой" onClick={() => onChange("grid")}>
        <LayoutGrid size={16} strokeWidth={1.8} />
      </button>
      <button type="button" className={view === "list" ? "active" : ""} aria-label="Списком" title="Списком" onClick={() => onChange("list")}>
        <List size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}

// Полоса фильтра по типу: «Все» + пилюли типов со счётчиками.
// Единый ряд: фильтр по типу + счётчик + «+» для создания. Типы без документов
// не фильтруются (нечего показывать), но создать их можно.
function TypeFilterBar({
  typeKeys, documents, value, onChange, onCreate,
}: { typeKeys: string[]; documents: Document[]; value: string; onChange: (v: string) => void; onCreate: (type: string) => void }) {
  return (
    <div className="type-filter">
      <span className="type-filter-label">Тип</span>
      <button type="button" className={`pill${value === "all" ? " active" : ""}`} onClick={() => onChange("all")}>
        Все <span className="pill-count">{documents.length}</span>
      </button>
      {typeKeys.map((t) => {
        const def = getDocumentType(t);
        const count = documents.filter((d) => d.type === t).length;
        return (
          <span key={t} className={`pill pill-split${value === t ? " active" : ""}${count === 0 ? " empty" : ""}`}>
            <button
              type="button"
              className="pill-split-main"
              disabled={count === 0}
              onClick={() => onChange(value === t ? "all" : t)}
            >
              {def?.label ?? t}
              <span className="pill-count" style={{ color: typeColor(t) }}>{count}</span>
            </button>
            <button type="button" className="pill-split-add" title={`Создать: ${def?.label ?? t}`} onClick={() => onCreate(t)}>
              +
            </button>
          </span>
        );
      })}
    </div>
  );
}

// Осмысленное пустое состояние раздела: иконка, объяснение, быстрые кнопки создания
// по ключевым типам и ссылка в Мастерскую.
function LibraryEmpty({
  icon: Icon, title, typeKeys, createDocument,
}: { icon: LucideIcon; title: string; typeKeys: string[]; createDocument: (type: string) => void }) {
  return (
    <div className="lib-empty">
      <Icon size={40} strokeWidth={1.4} className="lib-empty-icon" />
      <h2>В разделе «{title}» пока пусто</h2>
      <p className="muted">Создайте первый документ — или опишите идею в Мастерской, и ИИ предложит их за вас.</p>
      <div className="lib-empty-actions">
        {typeKeys.slice(0, 4).map((key) => {
          const t = getDocumentType(key);
          if (!t) return null;
          return (
            <button key={key} type="button" className="quick-create-item" onClick={() => createDocument(key)}>
              <TypeBadge type={key} size={20} /><span>{t.label}</span>
            </button>
          );
        })}
      </div>
      <Link to="../workshop" className="lib-empty-link"><Lightbulb size={15} strokeWidth={1.9} /> Открыть Мастерскую</Link>
    </div>
  );
}

// Библиотека документов (База знаний / Игровые материалы) — общий красивый каркас
// в духе Campaign Arks: шапка с переключателем вида, карточки-типы, фильтр, разделы.
export function TypedLibrary({
  icon: Icon, title, subtitle, typeKeys, documents, createDocument, storageKey,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: (count: number) => string;
  typeKeys: string[];
  documents: Document[];
  createDocument: (type: string) => void;
  storageKey: string;
}) {
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(storageKey) === "list" ? "list" : "grid"));
  const [filter, setFilter] = useState<string>("all");
  useEffect(() => { localStorage.setItem(storageKey, view); }, [storageKey, view]);

  const inScope = documents.filter((d) => typeKeys.includes(d.type));
  const present = typeKeys.filter((t) => inScope.some((d) => d.type === t));
  const visible = filter === "all" ? present : present.filter((t) => t === filter);

  return (
    <div className="view view-wide">
      <header className="view-head lib-head">
        <Icon size={24} strokeWidth={1.8} className="view-head-icon" />
        <div className="lib-head-main">
          <h1 className="page-title">{title}</h1>
          <p className="view-sub">{subtitle(inScope.length)}</p>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </header>

      {inScope.length === 0 ? (
        <LibraryEmpty icon={Icon} title={title} typeKeys={typeKeys} createDocument={createDocument} />
      ) : (
        <>
          <TypeFilterBar typeKeys={typeKeys} documents={inScope} value={filter} onChange={setFilter} onCreate={createDocument} />
          {visible.map((t) => <TypeSection key={t} type={t} documents={documents} view={view} />)}
        </>
      )}
    </div>
  );
}

// Кнопка-выпадашка смены типа документа — как «Change type to» в Campaign Arks.
export function ChangeTypeMenu({ current, onChange }: { current: string; onChange: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="type-menu" ref={ref}>
      <button
        type="button"
        className="btn-ghost icon-btn"
        title="Изменить тип"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Replace size={16} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="type-menu-pop" role="menu">
          <div className="type-menu-head">Изменить тип на</div>
          {DOCUMENT_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="menuitem"
              className="type-menu-item"
              disabled={t.key === current}
              onClick={() => { onChange(t.key); setOpen(false); }}
            >
              <span className="type-menu-ic" style={{ color: TYPE_COLORS[t.key]?.fg ?? "var(--muted)" }}>
                <DocIcon name={t.icon} size={16} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
