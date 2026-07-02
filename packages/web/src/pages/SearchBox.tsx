import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SearchHit } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function SearchBox({ campaignId }: { campaignId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  // Индекс подсвеченного результата для навигации стрелками (-1 — ничего).
  const [active, setActive] = useState(-1);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Запрос с задержкой: не дёргаем сервер на каждый символ; номер запроса
  // отсекает поздние ответы, чтобы они не затирали более свежие.
  useEffect(() => {
    const value = q.trim();
    if (!value) { setHits([]); setActive(-1); return; }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      api.search(campaignId, value)
        .then((res) => { if (seqRef.current === seq) { setHits(res); setActive(-1); } })
        .catch((e) => showToast(e instanceof Error ? e.message : "Ошибка поиска"));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, campaignId, showToast]);

  // Клик вне поля закрывает список результатов.
  useEffect(() => {
    if (hits.length === 0) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setHits([]); setActive(-1); }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [hits.length]);

  const close = () => { setQ(""); setHits([]); setActive(-1); };
  const href = (h: SearchHit) => `/campaigns/${campaignId}/documents/${h.docId}`;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (hits.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") {
      const h = hits[active] ?? hits[0];
      if (h) { e.preventDefault(); close(); navigate(href(h)); }
    }
  }

  return (
    <div className="search-box" ref={boxRef}>
      <input
        type="search"
        placeholder="Поиск по кампании…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-label="Поиск по кампании"
      />
      {!q && (
        <kbd className="search-kbd" title="Палитра команд: поиск и быстрые действия">
          {navigator.platform.toUpperCase().includes("MAC") ? "⌘K" : "Ctrl K"}
        </kbd>
      )}
      {hits.length > 0 && (
        <ul className="search-results">
          {hits.map((h, i) => (
            <li key={h.docId}>
              <Link
                to={href(h)}
                className={`search-hit${i === active ? " active" : ""}`}
                onClick={close}
                onMouseEnter={() => setActive(i)}
              >
                <span className="search-hit-title">{h.title}</span>
                <span className="search-type"> · {h.type}</span>
                {h.snippet && <span className="search-snippet">{h.snippet}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
