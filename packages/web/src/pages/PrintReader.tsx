import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Printer, X } from "lucide-react";
import { generateHTML } from "@tiptap/core";
import { getDocumentType, statusLabel, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { baseExtensions } from "../editor/extensions.js";

// Чистый «ридер для печати» — отдельная страница без интерфейса приложения,
// как в Campaign Arks. Рендерит документ (и, по желанию, связанные с ним) в
// читаемый макет и открывает системный диалог печати.
function contentToHtml(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  try {
    return generateHTML(content as Record<string, unknown>, baseExtensions);
  } catch {
    return "";
  }
}

export function PrintReader() {
  const { campaignId, documentId } = useParams<{ campaignId: string; documentId: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Document | null>(null);
  const [refs, setRefs] = useState<Document[]>([]);
  const [includeRefs, setIncludeRefs] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    api.getDocument(documentId).then(setDoc).catch(() => setDoc(null));
  }, [documentId]);

  // Связанные документы подгружаем один раз при первом включении тумблера.
  useEffect(() => {
    if (!includeRefs || !documentId || refs.length > 0) return;
    api.listDocumentLinks(documentId).then(async (links) => {
      const ids = Array.from(new Set(links.outgoing.map((l) => l.document.id))).filter((id) => id !== documentId);
      const docs = await Promise.all(ids.map((id) => api.getDocument(id).catch(() => null)));
      setRefs(docs.filter((d): d is Document => d !== null));
    }).catch(() => {});
  }, [includeRefs, documentId, refs.length]);

  const sections = useMemo(() => {
    const all = doc ? [doc, ...(includeRefs ? refs : [])] : [];
    return all.map((d) => ({ doc: d, html: contentToHtml(d.contentJson) }));
  }, [doc, refs, includeRefs]);

  function close() {
    navigate(`/campaigns/${campaignId}/documents/${documentId}`, { replace: true });
  }

  if (!doc) return <div className="print-page"><p className="muted">…</p></div>;

  return (
    <div className="print-page">
      <div className="print-bar">
        <button type="button" className="btn-ghost" onClick={close}><X size={16} /> Закрыть</button>
        <label className="print-toggle">
          <input type="checkbox" checked={includeRefs} onChange={(e) => setIncludeRefs(e.target.checked)} />
          Со связанными документами
        </label>
        <button type="button" onClick={() => window.print()}><Printer size={16} /> Печать</button>
      </div>

      <article className="print-doc">
        {sections.map(({ doc: d, html }, i) => {
          const t = getDocumentType(d.type);
          return (
            <section key={d.id} className={`print-section${i > 0 ? " print-break" : ""}`}>
              <header className="print-head">
                <span className="print-type">{t?.label ?? d.type}</span>
                <h1>{d.title}</h1>
                {d.status && <span className="print-status">{statusLabel(d.status)}</span>}
              </header>
              {html
                ? <div className="print-body" dangerouslySetInnerHTML={{ __html: html }} />
                : <p className="muted">Документ пуст.</p>}
            </section>
          );
        })}
      </article>
    </div>
  );
}
