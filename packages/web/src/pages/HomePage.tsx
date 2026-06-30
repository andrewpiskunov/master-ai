import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Sparkles, RefreshCw, MessageCircle, FileText } from "lucide-react";
import type { Campaign } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

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

export function HomePage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listCampaigns()
      .then(setCampaigns)
      .catch(() => showToast("Не удалось загрузить кампании"))
      .finally(() => setLoaded(true));
  }, [showToast]);

  async function create(rawName: string) {
    const n = rawName.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const created = await api.createCampaign({ name: n });
      navigate(`/campaigns/${created.id}/workshop`);
    } catch {
      showToast("Не удалось создать кампанию");
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    create(name);
  }

  const sorted = useMemo(
    () => [...campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [campaigns],
  );

  // Нет кампаний — экран приветствия с созданием первой.
  if (loaded && campaigns.length === 0) {
    return <main className="home"><WelcomeScreen onCreate={create} busy={busy} /></main>;
  }

  return (
    <main className="home">
      <h1 className="page-title">Продолжить</h1>

      <ul className="campaign-list">
        {sorted.map((c) => (
          <li key={c.id}>
            <Link to={`/campaigns/${c.id}`} className="campaign-card">
              <span className="campaign-card-body">
                <span className="campaign-card-name">{c.name}</span>
                <span className="campaign-card-meta">Обновлено {formatWhen(c.createdAt)}</span>
              </span>
              <span className="campaign-card-go" aria-hidden="true"><ArrowRight size={20} /></span>
            </Link>
          </li>
        ))}
      </ul>

      <hr className="home-divider" />

      {creating ? (
        <form className="card create-form" onSubmit={handleSubmit}>
          <label htmlFor="campaign-name">Название кампании</label>
          <input
            id="campaign-name"
            placeholder="Например, Тень над Глубоководьем"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <div className="home-actions">
            <button type="submit" disabled={busy}>{busy ? "Создаём…" : "Создать"}</button>
            <button type="button" className="btn-ghost" onClick={() => { setCreating(false); setName(""); }}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-ghost home-new" onClick={() => setCreating(true)}>
          <Plus size={18} strokeWidth={2} /> Новая кампания
        </button>
      )}
    </main>
  );
}
