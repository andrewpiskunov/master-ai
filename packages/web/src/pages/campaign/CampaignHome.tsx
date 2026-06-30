import { Link } from "react-router-dom";
import { Bookmark, Clock, Plus } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType, type Document } from "@master-ai/shared";
import { useBookmarks } from "../../bookmarks.js";
import { DocCard, TypeBadge, TypeTag, TypeSection, useCampaign } from "./shared.js";

// Порядок разделов на «Обзоре» и в «Быстром создании».
const HOME_ORDER = ["session", "pc", "npc", "location", "faction", "arc", "scene", "encounter", "secret", "item", "lore", "reference", "note"];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return "только что";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

export function CampaignHome() {
  const { campaignId, campaign, documents, createDocument } = useCampaign();
  const bookmarks = useBookmarks(campaignId);
  const bookmarked = bookmarks
    .map((b) => documents.find((d) => d.id === b.id))
    .filter((d): d is Document => Boolean(d));
  const recent = [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const present = HOME_ORDER.filter((t) => documents.some((d) => d.type === t));

  return (
    <div className="view view-wide">
      <header className="view-head">
        <div>
          <h1 className="page-title">{campaign?.name ?? "…"}</h1>
          <p className="view-sub">Рабочее пространство кампании</p>
        </div>
      </header>

      <div className="home2">
        <div className="home2-main">
          {bookmarked.length > 0 && (
            <section className="type-section">
              <div className="type-section-head">
                <Bookmark size={18} strokeWidth={1.9} className="home2-sec-icon" />
                <h2>Закладки</h2>
                <span className="count-badge">{bookmarked.length}</span>
              </div>
              <ul className="doc-cards grid">
                {bookmarked.map((d) => <li key={d.id}><DocCard doc={d} variant="tile" /></li>)}
              </ul>
            </section>
          )}

          {present.length === 0 && bookmarked.length === 0 ? (
            <section className="panel home2-empty">
              <h2>С чего начать</h2>
              <p className="muted">
                Опишите идею в Мастерской — ИИ ответит, задаст вопросы и предложит NPC, локации,
                секреты и сцены. Принятые предложения попадают в Базу знаний и Игровые материалы.
              </p>
              <div className="home-actions">
                <Link className="btn" to="workshop">Открыть Мастерскую</Link>
                <Link className="btn btn-ghost" to="knowledge">База знаний</Link>
              </div>
            </section>
          ) : (
            present.map((t) => <TypeSection key={t} type={t} documents={documents} view="grid" />)
          )}
        </div>

        <aside className="home2-aside">
          <section className="panel">
            <div className="panel-head"><Clock size={16} strokeWidth={1.9} /><h3>Недавно изменённые</h3></div>
            {recent.length === 0 ? (
              <p className="muted">Пока нет документов.</p>
            ) : (
              <ul className="recent-list">
                {recent.map((d) => (
                  <li key={d.id}>
                    <Link to={`/campaigns/${campaignId}/documents/${d.id}`} className="recent-item">
                      <TypeBadge type={d.type} size={32} />
                      <span className="recent-body">
                        <span className="recent-title">{d.title}</span>
                        <span className="recent-meta">Обновлено {relTime(d.updatedAt)}</span>
                      </span>
                      <TypeTag type={d.type} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><Plus size={16} strokeWidth={2} /><h3>Быстрое создание</h3></div>
            <div className="quick-create">
              {HOME_ORDER.map((key) => {
                const t = getDocumentType(key);
                if (!t) return null;
                return (
                  <button key={key} type="button" className="quick-create-item" onClick={() => createDocument(key)}>
                    <TypeBadge type={key} size={22} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
