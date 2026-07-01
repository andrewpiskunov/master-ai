import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, Check, Loader } from "lucide-react";
import type { ConsistencyIssue, Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { Modal } from "../../ui/Modal.js";

// Проверка кампании на противоречия: кнопка запускает ИИ-сверку и показывает список расхождений.
export function ConsistencyCheck({ campaignId, documents }: { campaignId: string; documents: Document[] }) {
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<ConsistencyIssue[] | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    setOpen(true);
    setLoading(true);
    setIssues(null);
    try {
      const res = await api.checkConsistency(campaignId);
      setIssues(res.issues);
    } catch {
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }

  function docHref(title: string): string | null {
    const clean = title.replace(/^[«"']+|[»"']+$/g, "").trim().toLowerCase();
    const d = documents.find((x) => x.title.toLowerCase() === clean);
    return d ? `/campaigns/${campaignId}/documents/${d.id}` : null;
  }

  return (
    <>
      <button type="button" className="btn-ghost consistency-btn" onClick={run} disabled={loading}>
        <ShieldAlert size={15} strokeWidth={1.8} /> Проверить на противоречия
      </button>
      {open && (
        <Modal title="Проверка на противоречия" onClose={() => setOpen(false)}>
          {loading ? (
            <p className="muted consistency-status"><Loader size={14} className="spin" /> ИИ сверяет документы кампании…</p>
          ) : issues && issues.length > 0 ? (
            <ul className="issue-list">
              {issues.map((iss, i) => (
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
        </Modal>
      )}
    </>
  );
}
