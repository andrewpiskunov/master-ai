import { Lightbulb } from "lucide-react";
import { WorkshopPanel } from "../WorkshopPanel.js";
import { RecentlyCreated, useCampaign } from "./shared.js";

export function WorkshopView() {
  const { campaignId, documents, reload } = useCampaign();
  return (
    <div className="view">
      <header className="view-head">
        <Lightbulb size={24} strokeWidth={1.8} className="view-head-icon" />
        <div>
          <h1 className="page-title">Мастерская</h1>
          <p className="view-sub">Обсудите идею с ИИ — он ответит и предложит документы для кампании.</p>
        </div>
      </header>
      <div className="ws-grid">
        <WorkshopPanel campaignId={campaignId} onApproved={reload} />
        <RecentlyCreated documents={documents} />
      </div>
    </div>
  );
}
