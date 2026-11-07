import { useEffect, useMemo, useState, useId, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Sparkles, RefreshCw, MessageCircle, FileText, Cpu, Search, ImagePlus, Clock3, Compass, X, ChevronDown } from "lucide-react";
import type { Campaign, GlobalLlmUsageStats } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { fmtDuration, fmtTokens, plural } from "../../lib/format.js";
import { useToast } from "../../ui/toast.js";
import { CampaignCoverPicker } from "./CampaignCoverPicker.js";
import "./HomePage.css";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(d);
}

// Заготовки названий кампаний — для «Нужна идея?» на экране приветствия.
const NAME_IDEAS = [
  "Тени Старого Тракта", "Колокола Пепельной Гавани", "Корона Утонувших Королей",
  "Тропа Стеклянного Ледника", "Оссуарий Пробуждённых Святых", "Знамя Восставшей Звезды",
  "Могильник Трясинного Червя", "Осада Тлеющего Дозора", "Хроники Безмолвной Заставы",
  "Дети Полуночного Двора", "Песни Утопленной Долины", "Печать Седьмого Замка",
  "Гончие Багрового Тумана", "Завет Ледяного Пламени", "Шёпот Подземных Ярусов",
  "Маяк на Краю Бурь",
];

function pickIdeas(): string[] {
  const shuffled = [...NAME_IDEAS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 5);
}

function WelcomeScreen({ onCreate, busy }: { onCreate: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [ideas, setIdeas] = useState<string[]>(() => pickIdeas());

  return (
    <div className="welcome-wrap">
      <form className="welcome" onSubmit={(e) => { e.preventDefault(); onCreate(name); }}>
        <h1 className="welcome-title">Добро пожаловать — создадим первую кампанию</h1>
        <p className="welcome-sub">Назовите её, а дальше я помогу выстроить мир.</p>

        <input
          className="welcome-input"
          aria-label="Название кампании"
          placeholder="Как называется ваша кампания?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <div className="welcome-spark-head">
          <span className="welcome-spark-label"><Sparkles size={14} /> Нужна идея?</span>
          <button type="button" className="welcome-refresh" onClick={() => setIdeas(pickIdeas())}>
            <RefreshCw size={13} /> Обновить
          </button>
        </div>
        <div className="welcome-ideas">
          {ideas.map((idea) => (
            <button key={idea} type="button" className="welcome-idea" onClick={() => setName(idea)}>{idea}</button>
          ))}
        </div>

        <button type="submit" className="welcome-create" disabled={!name.trim() || busy}>
          <Plus size={18} strokeWidth={2} /> {busy ? "Создаём кампанию…" : "Создать кампанию"}
        </button>

        <div className="welcome-divider"><span>Дальше</span></div>
        <ul className="welcome-steps">
          <li><Sparkles size={16} /> Помощник откроется с идеями по вашему названию</li>
          <li><MessageCircle size={16} /> Вы дорабатываете кампанию в коротком чате с ИИ</li>
          <li><FileText size={16} /> Лучшие идеи станут первыми документами кампании</li>
        </ul>
      </form>
    </div>
  );
}

function CampaignCover({ campaign }: { campaign: Campaign }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const artId = useId();
  if (campaign.cover && failedId !== campaign.cover.id) {
    return <img className="library-cover-image" src={`/api/images/${campaign.cover.id}`} alt={`Обложка кампании «${campaign.name}»`} loading="lazy" onError={() => setFailedId(campaign.cover!.id)} />;
  }
  return <div className="library-cover-placeholder" aria-hidden="true">
    <svg viewBox="0 0 640 360" fill="none" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id={artId} x1="320" y1="0" x2="320" y2="360" gradientUnits="userSpaceOnUse"><stop stopColor="#1d3040" /><stop offset="1" stopColor="#111b28" /></linearGradient></defs>
      <path fill={`url(#${artId})`} d="M0 0h640v360H0z" />
      <g stroke="#78959f" strokeWidth="1" opacity=".18"><circle cx="320" cy="170" r="128" /><circle cx="320" cy="170" r="108" strokeDasharray="2 8" /><path d="M320 25v290M175 170h290M217 67l206 206M217 273 423 67" /></g>
      <circle cx="452" cy="89" r="24" fill="#b9a57b" opacity=".42" />
      <path d="m0 257 94-89 59 47 94-117 92 109 59-62 83 75 70-49 89 98v91H0Z" fill="#263d47" />
      <path d="m153 215 94-117 92 109-46-23-41-57-45 63Z" fill="#71908f" opacity=".34" />
      <path d="m0 307 110-73 86 45 130-71 90 55 89-28 135 70v55H0Z" fill="#182d37" />
      <path d="M0 337c104-42 166-3 252-26 117-31 215-28 388 26v23H0Z" fill="#10212d" />
      <path d="m326 208-30 53 27 14-43 39 43-16 30-26-30-20 26-28" stroke="#b5a783" strokeWidth="2" opacity=".38" />
      <g stroke="#c3b38e" opacity=".7"><path d="M320 139v25m0 12v25m-31-31h25m12 0h25" /><path d="m320 154 9 16-9 16-9-16Z" fill="#c3b38e" fillOpacity=".08" /></g>
      <g fill="#a9c0c5" opacity=".5"><circle cx="124" cy="87" r="1.5" /><circle cx="188" cy="52" r="1" /><circle cx="388" cy="43" r="1.5" /><circle cx="510" cy="137" r="1" /></g>
    </svg>
    <span className="library-cover-caption">Новая глава впереди</span>
  </div>;
}

type CampaignOrder = "activity" | "created" | "name";
const UNSPECIFIED = "__unspecified";
function activityDate(campaign: Campaign): string { return campaign.updatedAt || campaign.createdAt; }

export function HomePage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const searchId = useId();
  const systemId = useId();
  const sortId = useId();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<string[]>(() => pickIdeas());
  const [usage, setUsage] = useState<GlobalLlmUsageStats | null>(null);
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState("all");
  const [order, setOrder] = useState<CampaignOrder>("activity");
  const [editingCover, setEditingCover] = useState<Campaign | null>(null);

  useEffect(() => {
    let current = true;
    api.listCampaigns()
      .then((result) => { if (current) setCampaigns(result); })
      .catch(() => { if (current) { setLoadError(true); showToast("Не удалось загрузить кампании"); } })
      .finally(() => { if (current) setLoaded(true); });
    api.llmUsageGlobal().then((result) => { if (current) setUsage(result); }).catch(() => {});
    return () => { current = false; };
  }, [showToast]);

  async function create(rawName: string) {
    const n = rawName.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const created = await api.createCampaign({ name: n });
      navigate(`/campaigns/${created.id}`);
    } catch {
      showToast("Не удалось создать кампанию");
      setBusy(false);
    }
  }
  function handleSubmit(e: FormEvent) { e.preventDefault(); void create(name); }
  function resetControls() { setQuery(""); setSystem("all"); setOrder("activity"); }

  const systems = useMemo(() => Array.from(new Set(campaigns.map((campaign) => campaign.system?.trim()).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, "ru")), [campaigns]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return campaigns.filter((campaign) => {
      const matchesSystem = system === "all" || (system === UNSPECIFIED ? !campaign.system?.trim() : campaign.system?.trim() === system);
      return matchesSystem && (!needle || [campaign.name, campaign.description, campaign.system].some((value) => value?.toLocaleLowerCase("ru").includes(needle)));
    }).sort((a, b) => order === "name"
      ? a.name.localeCompare(b.name, "ru")
      : (order === "created" ? b.createdAt.localeCompare(a.createdAt) : activityDate(b).localeCompare(activityDate(a))) || a.name.localeCompare(b.name, "ru"));
  }, [campaigns, query, system, order]);

  if (loaded && !loadError && campaigns.length === 0) {
    return <main className="home"><WelcomeScreen onCreate={create} busy={busy} /></main>;
  }

  return <main className="home campaign-library">
    <header className="library-header">
      <div><p className="library-eyebrow"><Compass size={14} strokeWidth={1.6} /> Мастерская миров</p><h1>Кампании</h1><p className="library-intro">Ваши истории, миры и приключения. Продолжим?</p></div>
      {!creating && <button type="button" className="library-new" onClick={() => setCreating(true)}><Plus size={17} /> Новая кампания</button>}
    </header>

    {creating && <form className="card create-form library-create" onSubmit={handleSubmit}>
      <label htmlFor="campaign-name">Название кампании</label>
      <input id="campaign-name" placeholder="Например, Тень над Глубоководьем" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="welcome-spark-head"><span className="welcome-spark-label"><Sparkles size={14} /> Нужна идея?</span><button type="button" className="welcome-refresh" onClick={() => setIdeas(pickIdeas())}><RefreshCw size={13} /> Обновить</button></div>
      <div className="welcome-ideas">{ideas.map((idea) => <button key={idea} type="button" className="welcome-idea" onClick={() => setName(idea)}>{idea}</button>)}</div>
      <div className="home-actions"><button type="submit" disabled={!name.trim() || busy}>{busy ? "Создаём…" : "Создать"}</button><button type="button" className="btn-ghost" disabled={busy} onClick={() => { setCreating(false); setName(""); }}>Отмена</button></div>
    </form>}

    <div className="library-toolbar">
      <div className="library-search"><label className="sr-only" htmlFor={searchId}>Поиск кампаний</label><Search size={17} aria-hidden="true" /><input id={searchId} type="search" placeholder="Название, описание или система" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" className="btn-ghost" aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={15} /></button>}</div>
      <div className="library-filter"><label htmlFor={systemId}>Игровая система</label><select id={systemId} value={system} onChange={(event) => setSystem(event.target.value)}><option value="all">Все системы</option>{systems.map((value) => <option key={value} value={value}>{value}</option>)}<option value={UNSPECIFIED}>Без системы</option></select></div>
      <div className="library-filter"><label htmlFor={sortId}>Порядок кампаний</label><select id={sortId} value={order} onChange={(event) => setOrder(event.target.value as CampaignOrder)}><option value="activity">По последней активности</option><option value="created">Сначала новые</option><option value="name">По названию: А–Я</option></select></div>
    </div>
    <div className="library-results"><span aria-live="polite">{loaded ? `${visible.length} ${plural(visible.length, ["кампания", "кампании", "кампаний"])}${query.trim() || system !== "all" ? ` из ${campaigns.length}` : ""}` : "Загружаем кампании…"}</span>{(query.trim() || system !== "all") && <button type="button" className="btn-ghost" onClick={resetControls}>Сбросить фильтры</button>}</div>

    {!loaded ? <div className="library-loading" role="status"><Compass size={28} strokeWidth={1.2} /><span>Открываем ваши миры…</span></div>
      : loadError ? <div className="library-empty"><Compass size={30} strokeWidth={1.2} /><h2>Не получилось открыть каталог</h2><p>Обновите страницу, чтобы загрузить кампании снова.</p></div>
      : visible.length === 0 ? <div className="library-empty"><Search size={30} strokeWidth={1.2} /><h2>Кампании не найдены</h2><p>Попробуйте другое название или выберите другую систему.</p></div>
      : <ul className="library-grid" aria-label="Кампании">{visible.map((campaign) => <li key={campaign.id} className="library-card">
        <Link to={`/campaigns/${campaign.id}`} className="library-card-link" aria-label={campaign.name}>
          <div className="library-cover"><CampaignCover campaign={campaign} /><span className="library-system">{campaign.system?.trim() || "Без системы"}</span></div>
          <div className="library-card-content"><h2>{campaign.name}</h2><p className={`library-description${campaign.description?.trim() ? "" : " is-empty"}`}>{campaign.description?.trim() || "У каждой истории есть начало. Какой будет следующая глава?"}</p><div className="library-card-footer"><span><Clock3 size={12} /> <time dateTime={activityDate(campaign)}>{formatWhen(activityDate(campaign))}</time></span><ArrowRight size={17} aria-hidden="true" /></div></div>
        </Link>
        <button type="button" className="library-cover-edit" aria-label={`Изменить обложку «${campaign.name}»`} title="Изменить обложку" onClick={() => setEditingCover(campaign)}><ImagePlus size={16} /></button>
      </li>)}</ul>}

    {usage && usage.total.requests > 0 && <details className="library-usage">
      <summary><span><Cpu size={15} /> Расход нейросети по всем кампаниям</span><ChevronDown size={16} /></summary>
      <div className="library-usage-body"><div className="usage-total"><span className="usage-total-num">{usage.total.estimated ? "≈ " : ""}{fmtTokens(usage.total.promptTokens + usage.total.completionTokens)}</span><span className="usage-total-sub">токенов за {fmtTokens(usage.total.requests)} {plural(usage.total.requests, ["запрос", "запроса", "запросов"])} · среднее время ответа {fmtDuration(usage.total.avgDurationMs)}</span></div>
        <div className="library-usage-scroll"><table className="usage-table"><thead><tr><th>Кампания</th><th>Запросы</th><th>Токены</th><th>Ср. время</th></tr></thead><tbody>{usage.byCampaign.map((campaign) => <tr key={campaign.campaignId}><td>{campaign.name}</td><td>{fmtTokens(campaign.requests)}</td><td>{campaign.estimated ? "≈ " : ""}{fmtTokens(campaign.promptTokens + campaign.completionTokens)}</td><td>{fmtDuration(campaign.avgDurationMs)}</td></tr>)}</tbody></table></div>
      </div>
    </details>}
    {editingCover && <CampaignCoverPicker campaign={editingCover} onChange={(updated) => setCampaigns((current) => current.map((campaign) => campaign.id === updated.id ? updated : campaign))} onClose={() => setEditingCover(null)} />}
  </main>;
}
