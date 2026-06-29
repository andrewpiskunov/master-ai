import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  DOCUMENT_TYPES,
  type Campaign,
  type Document,
} from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";
import { WorkshopPanel } from "./WorkshopPanel.js";
import { SearchBox } from "./SearchBox.js";

export function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [type, setType] = useState(DOCUMENT_TYPES[0].key);

  const loadDocuments = useCallback(() => {
    if (!campaignId) return;
    api.listCampaignDocuments(campaignId).then(setDocuments).catch(() => showToast("Не удалось загрузить документы"));
  }, [campaignId, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    api.getCampaign(campaignId).then(setCampaign).catch(() => showToast("Не удалось загрузить кампанию"));
    loadDocuments();
  }, [campaignId, showToast, loadDocuments]);

  async function createDocument() {
    if (!campaignId) return;
    try {
      const doc = await api.createDocument({ campaignId, type, title: "Без названия" });
      navigate(`/documents/${doc.id}`);
    } catch {
      showToast("Не удалось создать документ");
    }
  }

  const byType = DOCUMENT_TYPES.map((t) => ({
    type: t,
    docs: documents.filter((d) => d.type === t.key),
  })).filter((g) => g.docs.length > 0);

  return (
    <main>
      <p><Link to="/">← Кампании</Link></p>
      <h1>{campaign?.name ?? "…"}</h1>

      <SearchBox campaignId={campaignId!} />

      <WorkshopPanel campaignId={campaignId!} onApproved={loadDocuments} />

      <div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип документа">
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        <button type="button" onClick={createDocument}>Новый документ</button>
      </div>

      {byType.map((group) => (
        <section key={group.type.key}>
          <h2>{group.type.label}</h2>
          <ul>
            {group.docs.map((d) => (
              <li key={d.id}>
                <Link to={`/documents/${d.id}`}>{d.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
