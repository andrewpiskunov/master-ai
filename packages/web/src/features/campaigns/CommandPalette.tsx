import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Home, Lightbulb, BookOpen, Layers, Settings, Plus, Play, Search } from "lucide-react";
import { getDocumentType, type Document } from "@master-ai/shared";
import { TypeBadge } from "./shared.js";

interface Cmd { id: string; label: string; hint?: string; icon: ReactNode; run: () => void }

// Командная палитра (Cmd/Ctrl-K): навигация, создание, запуск сессии, открытие документа.
export function CommandPalette({
  campaignId, documents, onCreate, onClose,
}: {
  campaignId: string;
  documents: Document[];
  onCreate: (type: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands: Cmd[] = useMemo(() => {
    const go = (path: string) => { navigate(path); onClose(); };
    const base: Cmd[] = [
      { id: "nav-overview", label: "Обзор", icon: <Home size={16} />, run: () => go(`/campaigns/${campaignId}`) },
      { id: "nav-workshop", label: "Мастерская", icon: <Lightbulb size={16} />, run: () => go(`/campaigns/${campaignId}/workshop`) },
      { id: "nav-knowledge", label: "База знаний", icon: <BookOpen size={16} />, run: () => go(`/campaigns/${campaignId}/knowledge`) },
      { id: "nav-play", label: "Игровые материалы", icon: <Layers size={16} />, run: () => go(`/campaigns/${campaignId}/play`) },
      { id: "nav-manage", label: "Управление кампанией", icon: <Settings size={16} />, run: () => go(`/campaigns/${campaignId}/manage`) },
      { id: "new", label: "Новый документ", icon: <Plus size={16} />, run: () => { onClose(); onCreate("note"); } },
    ];
    const sessions: Cmd[] = documents.filter((d) => d.type === "session").map((s) => ({
      id: `play-${s.id}`, label: `Запустить: ${s.title}`, icon: <Play size={16} />,
      run: () => go(`/campaigns/${campaignId}/sessions/${s.id}/play`),
    }));
    const docs: Cmd[] = documents.map((d) => ({
      id: `doc-${d.id}`, label: d.title, hint: getDocumentType(d.type)?.label ?? d.type,
      icon: <TypeBadge type={d.type} size={16} />, run: () => go(`/campaigns/${campaignId}/documents/${d.id}`),
    }));
    return [...base, ...sessions, ...docs];
  }, [campaignId, documents, navigate, onClose, onCreate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 12);
    return commands.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(q)).slice(0, 25);
  }, [commands, query]);

  useEffect(() => { setIndex(0); }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); filtered[index]?.run(); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, index, onClose]);

  return (
    <div className="cmd-overlay" onMouseDown={onClose}>
      <div className="cmd-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <Search size={16} className="cmd-search-icon" />
          <input autoFocus className="cmd-input" placeholder="Команда или документ…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ul className="cmd-list">
          {filtered.length === 0 && <li className="cmd-empty">Ничего не найдено</li>}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button type="button" className={`cmd-item${i === index ? " active" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => c.run()}>
                <span className="cmd-item-icon">{c.icon}</span>
                <span className="cmd-item-label">{c.label}</span>
                {c.hint && <span className="cmd-item-hint">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
