import { useState } from "react";
import { Link } from "react-router-dom";
import type { SearchHit } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function SearchBox({ campaignId }: { campaignId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const { showToast } = useToast();

  async function run(value: string) {
    setQ(value);
    if (!value.trim()) {
      setHits([]);
      return;
    }
    try {
      setHits(await api.search(campaignId, value));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка поиска");
    }
  }

  return (
    <div className="search-box">
      <input
        type="search"
        placeholder="Поиск по кампании…"
        value={q}
        onChange={(e) => run(e.target.value)}
      />
      {!q && (
        <kbd className="search-kbd" title="Палитра команд: поиск и быстрые действия">
          {navigator.platform.toUpperCase().includes("MAC") ? "⌘K" : "Ctrl K"}
        </kbd>
      )}
      {hits.length > 0 && (
        <ul className="search-results">
          {hits.map((h) => (
            <li key={h.docId}>
              <Link to={`/documents/${h.docId}`}>{h.title}</Link>
              <span className="search-type"> · {h.type}</span>
              {h.snippet && <div className="search-snippet">{h.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
