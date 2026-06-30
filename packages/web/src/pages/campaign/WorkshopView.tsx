import { useMemo } from "react";
import { Lightbulb } from "lucide-react";
import { WorkshopPanel, WorkshopProposals } from "../WorkshopPanel.js";
import { RecentlyCreated, useCampaign } from "./shared.js";

export function WorkshopView() {
  const { campaignId, documents } = useCampaign();
  const mentions = useMemo(
    () => documents.map((d) => ({
      title: d.title,
      type: d.type,
      href: `/campaigns/${campaignId}/documents/${d.id}`,
    })),
    [campaignId, documents],
  );
  return (
    <div className="view view-wide">
      <header className="view-head">
        <Lightbulb size={24} strokeWidth={1.8} className="view-head-icon" />
        <div>
          <h1 className="page-title">Мастерская</h1>
          <p className="view-sub">Обсудите идею с ИИ — он ответит и предложит документы для кампании.</p>
        </div>
      </header>
      <div className="ws-grid">
        <WorkshopPanel mentions={mentions} />
        <div className="ws-aside">
          <WorkshopProposals />
          <RecentlyCreated documents={documents} />
        </div>
      </div>
    </div>
  );
}
