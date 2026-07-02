import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, Check, Loader, RefreshCw } from "lucide-react";
import type { ConsistencyIssue, Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { Modal } from "../../ui/Modal.js";

interface CachedResult { issues: ConsistencyIssue[]; at: string }

function ago(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

// Проверка кампании на противоречия: кнопка запускает ИИ-сверку и показывает список
// расхождений. Последний результат хранится в localStorage — закрытие модалки не
// заставляет гонять долгую проверку заново.
export function ConsistencyCheck({ campaignId, documents }: { campaignId: string; documents: Document[] }) {
  const cacheKey = `master-ai:consistency:${campaignId}`;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CachedResult | null>(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as CachedResult) : null;
    } catch { return null; }
  });
  const [open, setOpen] = useState(false);

  async function run() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await api.checkConsistency(campaignId);
      const next: CachedResult = { issues: res.issues, at: new Date().toISOString() };
      setResult(next);
      try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* приватный режим */ }
    } catch {
      if (!result) setResult({ issues: [], at: new Date().toISOString() });
    } finally {
      setLoading(false);
    }
  }

  // Есть свежий кеш — просто показываем его; проверку перезапускает кнопка «Обновить».
  function openOrRun() {
    if (result) setOpen(true);
    else void run();
  }

  function docHref(title: string): string | null {
    const clean = title.replace(/^[«"']+|[»"']+$/g, "").trim().toLowerCase();
    const d = documents.find((x) => x.title.toLowerCase() === clean);
    return d ? `/campaigns/${campaignId}/documents/${d.id}` : null;
  }

  return (
    <>
      <button type="button" className="btn-ghost consistency-btn" onClick={openOrRun} disabled={loading}>
        <ShieldAlert size={15} strokeWidth={1.8} /> Проверить на противоречия
      </button>
      {open && (
        <Modal title="Проверка на противоречия" onClose={() => setOpen(false)}>
          {loading ? (
            <p className="muted consistency-status"><Loader size={14} className="spin" /> ИИ сверяет документы кампании…</p>
          ) : (
            <>
              {result && (
                <div className="consistency-meta">
                  <span className="muted">Проверено {ago(result.at)}</span>
                  <button type="button" className="btn-ghost consistency-refresh" onClick={run}>
                    <RefreshCw size={13} strokeWidth={1.9} /> Обновить
                  </button>
                </div>
              )}
              {result && result.issues.length > 0 ? (
                <ul className="issue-list">
                  {result.issues.map((iss, i) => (
                    <li key={i} className="issue">
                      <div className="issue-docs">
                        {iss.documents.map((t, j) => {
                          const href = docHref(t);
                          return (
                            <Fragment key={j}>
                              {j > 0 && <span className="issue-sep"> ↔ </span>}
                              {href ? <Link to={href} onClick={() => setOpen(false)}>{t}</Link> : <span>{t}</span>}
                            </Fragment>
                          );
                        })}
                      </div>
                      <p className="issue-text">{iss.contradiction}</p>
                      {iss.fix && <p className="issue-fix">Как устранить: {iss.fix}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted consistency-status"><Check size={15} strokeWidth={2.2} /> Явных противоречий не найдено.</p>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
