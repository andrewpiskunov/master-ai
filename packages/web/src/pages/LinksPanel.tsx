import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DocumentLinks, Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function LinksPanel({ campaignId, documentId }: { campaignId: string; documentId: string }) {
  const [data, setData] = useState<DocumentLinks>({ outgoing: [], incoming: [] });
  const [candidates, setCandidates] = useState<Document[]>([]);
  const [targetId, setTargetId] = useState("");
  const [kind, setKind] = useState("");
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.listDocumentLinks(documentId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка загрузки связей");
    }
  }, [documentId, showToast]);

  useEffect(() => {
    load();
    api
      .listCampaignDocuments(campaignId)
      .then((docs) => setCandidates(docs.filter((d) => d.id !== documentId)))
      .catch(() => {});
  }, [campaignId, documentId, load]);

  async function addLink() {
    if (!targetId || !kind.trim()) return;
    try {
      await api.createLink({ campaignId, fromDocId: documentId, toDocId: targetId, kind });
      setTargetId("");
      setKind("");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось создать связь");
    }
  }

  async function remove(linkId: string) {
    try {
      await api.deleteLink(linkId);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось удалить связь");
    }
  }

  return (
    <aside className="links-panel">
      <h3>Связи</h3>
      <section>
        <h4>Исходящие</h4>
        <ul>
          {data.outgoing.map((l) => (
            <li key={l.linkId}>
              <Link to={`/documents/${l.document.id}`}>{l.document.title}</Link>
              <span> · {l.kind}</span>
              <button type="button" onClick={() => remove(l.linkId)}>удалить</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Обратные ссылки</h4>
        <ul>
          {data.incoming.map((l) => (
            <li key={l.linkId}>
              <Link to={`/documents/${l.document.id}`}>{l.document.title}</Link>
              <span> · {l.kind}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="links-add">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— документ —</option>
          {candidates.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
        <input placeholder="тип связи" value={kind} onChange={(e) => setKind(e.target.value)} />
        <button type="button" onClick={addLink}>Связать</button>
      </section>
    </aside>
  );
}
