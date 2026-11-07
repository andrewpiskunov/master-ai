import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Lightbulb, Settings } from "lucide-react";
import { WorkshopPanel, WorkshopProposals, WorldSummary } from "./WorkshopPanel.js";
import { RecentlyCreated, useCampaign } from "../campaigns/shared.js";

export function WorkshopView() {
  const { campaignId, campaign, documents } = useCampaign();
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
      {campaign && !campaign.description?.trim() && (
        <Link to={`/campaigns/${campaignId}/manage`} className="brief-nudge">
          <Settings size={15} strokeWidth={1.8} />
          <span>Бриф кампании пуст. Заполните его в управлении кампанией — тон, жанр и правила мира сделают ответы ИИ заметно точнее.</span>
        </Link>
      )}
      <div className="ws-grid">
        <div className="ws-chat-col">
          <WorkshopPanel mentions={mentions} />
        </div>
        <div className="ws-aside">
          <WorkshopProposals />
          <WorldSummary />
          <RecentlyCreated documents={documents} />
        </div>
      </div>
    </div>
  );
}
