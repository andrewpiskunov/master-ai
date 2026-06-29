import { Link, useOutletContext } from "react-router-dom";
import {
  User, MapPin, Users, Lock, Clapperboard, Calendar, Package, Book, File,
  type LucideIcon,
} from "lucide-react";
import { getDocumentType, type Campaign, type Document } from "@master-ai/shared";

// Деление типов документов на разделы — как в Campaign Arks.
export const KNOWLEDGE_TYPES = ["lore", "npc", "location", "faction", "note"];
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
  "map-pin": MapPin,
  users: Users,
  lock: Lock,
  clapperboard: Clapperboard,
  calendar: Calendar,
  package: Package,
  book: Book,
  file: File,
};

export function DocIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Cmp = ICONS[name] ?? File;
  return <Cmp size={size} strokeWidth={1.8} />;
}

export function DocCard({ doc }: { doc: Document }) {
  const t = getDocumentType(doc.type);
  return (
    <Link to={`/documents/${doc.id}`} className="doc-card">
      <span className="doc-card-icon"><DocIcon name={t?.icon ?? "file"} /></span>
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
            <span className="type-card-icon"><DocIcon name={t.icon} size={20} /></span>
            <span className="type-card-count">{count}</span>
            <span className="type-card-label">{t.label}</span>
            <span className="type-card-add">+ создать</span>
          </button>
        );
      })}
    </div>
  );
}
