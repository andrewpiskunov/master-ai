import { Link, useOutletContext } from "react-router-dom";
import {
  User, Shield, MapPin, Users, Lock, Clapperboard, Calendar, Package, Book, Library, File,
  type LucideIcon,
} from "lucide-react";
import { getDocumentType, type Campaign, type Document } from "@master-ai/shared";

// Деление типов документов на разделы — как в Campaign Arks.
export const KNOWLEDGE_TYPES = ["pc", "npc", "location", "faction", "lore", "reference", "note"];
export const PLAY_TYPES = ["scene", "session", "secret", "item"];

export interface CampaignContext {
  campaignId: string;
  campaign: Campaign | null;
  documents: Document[];
  reload: () => void;
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
};

// Цвет иконки (fg) + фон плитки (bg) для каждого типа.
const TYPE_COLORS: Record<string, { fg: string; bg: string }> = {
  pc: { fg: "#a3e635", bg: "#1a2e05" },
  npc: { fg: "#34d399", bg: "#0e2a20" },
  location: { fg: "#f59e0b", bg: "#2a1e06" },
  faction: { fg: "#c084fc", bg: "#221036" },
  secret: { fg: "#fb7185", bg: "#2a0f17" },
  scene: { fg: "#38bdf8", bg: "#06283b" },
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

export function DocCard({ doc, variant = "row" }: { doc: Document; variant?: "row" | "tile" }) {
  const t = getDocumentType(doc.type);
  if (variant === "tile") {
    return (
      <Link to={`/campaigns/${doc.campaignId}/documents/${doc.id}`} className="doc-tile">
        <TypeBadge type={doc.type} size={40} />
        <span className="doc-tile-title">{doc.title}</span>
      </Link>
    );
  }
  return (
    <Link to={`/campaigns/${doc.campaignId}/documents/${doc.id}`} className="doc-card">
      <TypeBadge type={doc.type} size={32} />
      <span className="doc-card-body">
        <span className="doc-card-title">{doc.title}</span>
        <span className="doc-card-type">{t?.label ?? doc.type}</span>
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

export function TypeCards({
  typeKeys,
  documents,
  onCreate,
}: {
  typeKeys: string[];
  documents: Document[];
  onCreate: (type: string) => void;
}) {
  return (
    <div className="type-cards">
      {typeKeys.map((key) => {
        const t = getDocumentType(key);
        if (!t) return null;
        const count = documents.filter((d) => d.type === key).length;
        return (
          <button key={key} type="button" className="type-card" onClick={() => onCreate(key)}>
            <span className="type-card-icon"><TypeBadge type={key} size={38} /></span>
            <span className="type-card-count">{count}</span>
            <span className="type-card-label">{t.label}</span>
            <span className="type-card-add">+ создать</span>
          </button>
        );
      })}
    </div>
  );
}

// Раздел документов одного типа: заголовок с цветной иконкой + счётчик + сетка карточек.
export function TypeSection({ type, documents }: { type: string; documents: Document[] }) {
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
      <ul className="doc-cards grid">
        {docs.map((d) => <li key={d.id}><DocCard doc={d} variant="tile" /></li>)}
      </ul>
    </section>
  );
}
