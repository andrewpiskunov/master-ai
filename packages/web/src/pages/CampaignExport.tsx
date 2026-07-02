import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Printer, X, Download } from "lucide-react";
import { getDocumentType, statusLabel, type Campaign, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { plural } from "../format.js";
import { contentToHtml } from "../editor/contentToHtml.js";
import { docToMarkdown } from "../editor/docToMarkdown.js";

const SECTION_ORDER = ["session", "arc", "scene", "encounter", "pc", "npc", "location", "faction", "secret", "item", "lore", "reference", "note"];

// Экспорт всей кампании: единый читаемый документ. «Печать / PDF» — через системный
// диалог печати (тот же generateHTML, что и ридер), «Markdown» — скачивание файла.
export function CampaignExport() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);

  useEffect(() => {
    if (!campaignId) return;
    api.getCampaign(campaignId).then(setCampaign).catch(() => {});
    api.listCampaignDocuments(campaignId).then(setDocs).catch(() => {});
  }, [campaignId]);

  const grouped = useMemo(() => {
    const order = (t: string) => { const i = SECTION_ORDER.indexOf(t); return i < 0 ? 999 : i; };
    return [...docs].sort((a, b) => order(a.type) - order(b.type) || a.title.localeCompare(b.title));
  }, [docs]);

  function downloadMd() {
    const parts = [`# ${campaign?.name ?? "Кампания"}`];
    if (campaign?.description?.trim()) parts.push(campaign.description.trim());
    let lastType = "";
    for (const d of grouped) {
      if (d.type !== lastType) { parts.push(`## ${getDocumentType(d.type)?.label ?? d.type}`); lastType = d.type; }
      parts.push(`### ${d.title}${d.status ? ` (${statusLabel(d.status)})` : ""}`);
      const body = docToMarkdown(d.contentJson, 2); // внутренние заголовки — под «### Название»
      if (body) parts.push(body);
    }
    const blob = new Blob([parts.join("\n\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaign?.name ?? "кампания"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="print-page">
      <div className="print-bar">
        <button type="button" className="btn-ghost" onClick={() => navigate(`/campaigns/${campaignId}/manage`, { replace: true })}><X size={16} /> Закрыть</button>
        <span className="print-count">{docs.length} {plural(docs.length, ["документ", "документа", "документов"])}</span>
        <button type="button" className="btn-ghost" onClick={downloadMd}><Download size={16} /> Markdown</button>
        <button type="button" onClick={() => window.print()}><Printer size={16} /> Печать / PDF</button>
      </div>

      <article className="print-doc">
        <section className="print-section">
          <h1>{campaign?.name ?? "…"}</h1>
          {campaign?.description?.trim() && <p>{campaign.description}</p>}
        </section>
        {grouped.map((d) => {
          const t = getDocumentType(d.type);
          const html = contentToHtml(d.contentJson);
          return (
            <section key={d.id} className="print-section print-break">
              <header className="print-head">
                <span className="print-type">{t?.label ?? d.type}</span>
                <h1>{d.title}</h1>
                {d.status && <span className="print-status">{statusLabel(d.status)}</span>}
              </header>
              {html ? <div className="print-body" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="muted">Документ пуст.</p>}
            </section>
          );
        })}
      </article>
    </div>
  );
}
