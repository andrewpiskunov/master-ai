import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getDocumentType, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { DocumentEditor } from "../editor/DocumentEditor.js";
import { useToast } from "../ui/toast.js";

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const { showToast } = useToast();
  const [doc, setDoc] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<string>("");
  const [contentJson, setContentJson] = useState<unknown>(null);

  useEffect(() => {
    if (!documentId) return;
    api.getDocument(documentId).then((d) => {
      setDoc(d);
      setTitle(d.title);
      setStatus(d.status ?? "");
      setContentJson(d.contentJson);
    }).catch(() => showToast("Не удалось загрузить документ"));
  }, [documentId, showToast]);

  async function save() {
    if (!documentId) return;
    try {
      const updated = await api.updateDocument(documentId, {
        title,
        status: status === "" ? null : status,
        contentJson,
      });
      setDoc(updated);
    } catch {
      showToast("Не удалось сохранить");
    }
  }

  if (!doc) return <main>…</main>;

  const statuses = getDocumentType(doc.type)?.statuses ?? [];

  return (
    <main>
      <p><Link to={`/campaigns/${doc.campaignId}`}>← Кампания</Link></p>

      <label htmlFor="doc-title">Заголовок</label>
      <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />

      {statuses.length > 0 && (
        <>
          <label htmlFor="doc-status">Статус</label>
          <select id="doc-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">—</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </>
      )}

      <DocumentEditor key={documentId} content={contentJson} onChange={setContentJson} />

      <button type="button" onClick={save}>Сохранить</button>
    </main>
  );
}
