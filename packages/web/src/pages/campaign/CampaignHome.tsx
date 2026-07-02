import { useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Clock, Plus, FileText, Play, ArrowRight, ExternalLink, PartyPopper } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType, statusLabel, type Document } from "@master-ai/shared";
import { useBookmarks } from "../../bookmarks.js";
import { prepareMentions, matchMentions } from "../../mentions.js";
import { DocCard, TypeBadge, TypeTag, useCampaign } from "./shared.js";
import { pmText } from "../../prosemirror-text.js";
import { CampaignOnboarding, foundationDoneCount } from "./CampaignOnboarding.js";
import { ConsistencyCheck } from "./ConsistencyCheck.js";

// Порядок разделов на «Обзоре». «session» выведен отдельной вкладкой сверху.
const SECTION_ORDER = ["pc", "npc", "location", "faction", "arc", "scene", "encounter", "secret", "item", "lore", "reference", "note"];
// Порядок в «Быстром создании» (сессия — первой).
const CREATE_ORDER = ["session", ...SECTION_ORDER];

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

function sessionNum(d: Document): number {
  return typeof d.fields?.sessionNumber === "number" ? d.fields.sessionNumber : 0;
}

function fmtSessionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function SessionStatus({ doc }: { doc: Document }) {
  const num = sessionNum(doc);
  const date = typeof doc.fields?.sessionDate === "string" ? fmtSessionDate(doc.fields.sessionDate) : "";
  const bits: string[] = [];
  if (num) bits.push(`Сессия ${num}`);
  if (date) bits.push(date);
  if (doc.status) bits.push(statusLabel(doc.status));
  return <span className="session-status">{bits.length ? bits.join(" • ") : "Без даты"}</span>;
}

// Панель сессий (как в Arks): предыдущая + текущая, кнопка запуска и список всех.
function SessionsBoard({ campaignId, sessions, documents, onNew }: { campaignId: string; sessions: Document[]; documents: Document[]; onNew: () => void }) {
  // По порядковому номеру (свежие сверху); при отсутствии номера — по дате изменения.
  const sorted = [...sessions].sort((a, b) => (sessionNum(b) - sessionNum(a)) || b.updatedAt.localeCompare(a.updatedAt));
  const current = sorted[0];
  const previous = sorted[1];
  const docHref = (id: string) => `/campaigns/${campaignId}/documents/${id}`;
  const playHref = (id: string) => `/campaigns/${campaignId}/sessions/${id}/play`;
  const [selectedId, setSelectedId] = useState(current?.id);
  const [showAllLinked, setShowAllLinked] = useState(false);
  const selected = sorted.find((s) => s.id === selectedId) ?? current;
  // Документы, упомянутые (@) в выбранной сессии — её «связанные документы».
  const linked = (() => {
    if (!selected) return [] as Document[];
    const prepared = prepareMentions(documents.filter((d) => d.id !== selected.id).map((d) => ({ title: d.title, type: d.type, href: d.id })));
    const ids = new Set(matchMentions(pmText(selected.contentJson), prepared).map((m) => m.href));
    return documents.filter((d) => ids.has(d.id));
  })();

  return (
    <div className="sessions-board">
      <div className="sessions-top">
        {previous && (
          <Link to={docHref(previous.id)} className="session-card session-prev">
            <span className="session-label">Предыдущая</span>
            <span className="session-title">{previous.title}</span>
            <SessionStatus doc={previous} />
          </Link>
        )}
        <div className={`session-card session-current${previous ? "" : " session-solo"}`}>
          <div className="session-current-head">
            <span className="session-label">Текущая сессия</span>
            <Link to={docHref(current.id)} className="session-continue">Продолжить <ArrowRight size={14} /></Link>
          </div>
          <span className="session-title">{current.title}</span>
          <SessionStatus doc={current} />
          <span className="session-edited">Изменено: {relTime(current.updatedAt)}</span>
          <Link to={playHref(current.id)} className="btn session-run"><Play size={15} /> Запустить сессию</Link>
        </div>
      </div>

      <div className="sessions-all panel">
        <div className="sessions-all-head">
          <h3>Все сессии</h3>
          <button type="button" className="sessions-new" onClick={onNew}><Plus size={14} strokeWidth={2} /> Новая</button>
        </div>
        <ul className="sessions-list">
          {sorted.map((s) => (
            <li key={s.id} className={`sessions-row${s.id === selectedId ? " selected" : ""}`} onClick={() => { setSelectedId(s.id); setShowAllLinked(false); }}>
              <FileText size={16} strokeWidth={1.7} className="sessions-row-icon" />
              <span className="sessions-row-title">{s.title}</span>
              <SessionStatus doc={s} />
              <Link to={playHref(s.id)} className="sessions-row-run" onClick={(e) => e.stopPropagation()}><Play size={13} /> Запустить</Link>
              <Link to={docHref(s.id)} className="sessions-row-open" onClick={(e) => e.stopPropagation()}>Открыть</Link>
            </li>
          ))}
        </ul>

        {selected && (
          <div className="sessions-preview">
            <div className="sessions-preview-head">
              <span className="sessions-preview-label">Связанные документы — {selected.title}</span>
              <Link to={docHref(selected.id)} className="sessions-preview-open"><ExternalLink size={13} /> Открыть сессию</Link>
            </div>
            {linked.length === 0 ? (
              <p className="muted sessions-preview-empty">Свяжите документы через «@»-упоминания в тексте сессии — и они появятся здесь.</p>
            ) : (
              <>
                <ul className="sessions-linked">
                  {(showAllLinked ? linked : linked.slice(0, 6)).map((d) => (
                    <li key={d.id}>
                      <Link to={docHref(d.id)} className="sessions-linked-item">
                        <TypeBadge type={d.type} size={20} />
                        <span className="sessions-linked-title">{d.title}</span>
                        <TypeTag type={d.type} />
                      </Link>
                    </li>
                  ))}
                </ul>
                {linked.length > 6 && (
                  <button type="button" className="sessions-linked-more" onClick={() => setShowAllLinked((v) => !v)}>
                    {showAllLinked ? "Свернуть" : `Показать все (${linked.length})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CampaignHome() {
  const { campaignId, campaign, documents, createDocument } = useCampaign();
  const bookmarks = useBookmarks(campaignId);
  const bookmarked = bookmarks
    .map((b) => documents.find((d) => d.id === b.id))
    .filter((d): d is Document => Boolean(d));
  const recent = [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const sessions = documents.filter((d) => d.type === "session");
  const present = SECTION_ORDER.filter((t) => documents.some((d) => d.type === t));

  return (
    <div className="view view-wide">
      <header className="view-head">
        <div>
          <h1 className="page-title">{campaign?.name ?? "…"}</h1>
          <p className="view-sub">Рабочее пространство кампании</p>
        </div>
      </header>

      {foundationDoneCount(campaign, documents) < 3 && sessions.length === 0 ? (
        <CampaignOnboarding campaignId={campaignId} campaign={campaign} documents={documents} createDocument={createDocument} />
      ) : (
      <div className="home2">
        <div className="home2-main">
          <section className="type-section">
            <div className="type-section-head">
              <TypeBadge type="session" size={24} />
              <h2>Сессии</h2>
              {sessions.length > 0 && <span className="count-badge">{sessions.length}</span>}
            </div>
            {sessions.length > 0 ? (
              <SessionsBoard campaignId={campaignId} sessions={sessions} documents={documents} onNew={() => createDocument("session")} />
            ) : (
              <div className="session-empty grad">
                <PartyPopper size={34} strokeWidth={1.6} />
                <h3>Основа кампании готова</h3>
                <p className="muted">Вы наполнили Базу знаний — теперь превратите основу в подготовку к столу и создайте первую сессию.</p>
                {(() => {
                  const built = ["pc", "npc", "location", "faction", "arc", "lore"]
                    .map((t) => ({ t, n: documents.filter((d) => d.type === t).length }))
                    .filter((x) => x.n > 0);
                  return built.length ? (
                    <div className="grad-counts">
                      {built.map((b) => (
                        <span key={b.t} className="grad-count"><TypeBadge type={b.t} size={16} /> {getDocumentType(b.t)?.label ?? b.t} {b.n}</span>
                      ))}
                    </div>
                  ) : null;
                })()}
                <button type="button" className="btn" onClick={() => createDocument("session")}>
                  <Plus size={16} strokeWidth={2} /> Создать первую сессию
                </button>
              </div>
            )}
          </section>

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

          {present.length === 0 && bookmarked.length === 0 && (
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
          )}
        </div>

        <aside className="home2-aside">
          {documents.length >= 2 && (
            <section className="panel consistency-panel">
              <ConsistencyCheck campaignId={campaignId} documents={documents} />
            </section>
          )}
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
              {CREATE_ORDER.map((key) => {
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
      )}
    </div>
  );
}
