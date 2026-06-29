import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
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

export function HomePage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listCampaigns().then(setCampaigns).catch(() => showToast("Не удалось загрузить кампании"));
  }, [showToast]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await api.createCampaign({ name: name.trim() });
      setName("");
      setCreating(false);
      navigate(`/campaigns/${created.id}`);
    } catch {
      showToast("Не удалось создать кампанию");
    }
  }

  const sorted = [...campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <main className="home">
      <h1 className="page-title">Продолжить</h1>

      {sorted.length === 0 ? (
        <p className="muted">Пока нет кампаний. Создайте первую.</p>
      ) : (
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
      )}

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
            <button type="submit">Создать</button>
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
