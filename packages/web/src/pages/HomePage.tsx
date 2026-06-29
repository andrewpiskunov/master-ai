import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Campaign } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function HomePage() {
  const { showToast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    api.listCampaigns().then(setCampaigns).catch(() => showToast("Не удалось загрузить кампании"));
  }, [showToast]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const created = await api.createCampaign({ name: name.trim() });
      setCampaigns((prev) => [...prev, created]);
      setName("");
    } catch {
      showToast("Не удалось создать кампанию");
    }
  }

  return (
    <main>
      <h1>master-ai</h1>
      <h2>Кампании</h2>
      <ul>
        {campaigns.map((c) => (
          <li key={c.id}>
            <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <label htmlFor="campaign-name">Название</label>
        <input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Создать</button>
      </form>
    </main>
  );
}
