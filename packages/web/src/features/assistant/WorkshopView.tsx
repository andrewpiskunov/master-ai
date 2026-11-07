import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Layers, Lightbulb, Settings } from "lucide-react";
import { WorkshopPanel, WorkshopProposals, WorldSummary } from "./WorkshopPanel.js";
import { RecentlyCreated, useCampaign } from "../campaigns/shared.js";
import "./WorkshopView.css";

export function WorkshopView() {
  const { campaignId, campaign, documents } = useCampaign();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const chatColumn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const column = chatColumn.current;
    if (!column) return;
    // Keep large drafts and attachment previews within the available chat panel.
    // An observed size avoids introducing a containing block for its import modal.
    const measure = () => column.style.setProperty("--workshop-height", `${column.clientHeight}px`);
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(column);
    window.addEventListener("resize", measure);
    return () => { resize?.disconnect(); window.removeEventListener("resize", measure); };
  }, [materialsOpen]);
  const mentions = useMemo(
    () => documents.map((d) => ({
      title: d.title,
      type: d.type,
      href: `/campaigns/${campaignId}/documents/${d.id}`,
    })),
    [campaignId, documents],
  );
  return (
    <div className="view view-wide workshop-view">
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
        <div className="ws-chat-col" ref={chatColumn}>
          <WorkshopPanel mentions={mentions} />
        </div>
        <div className={`ws-aside${materialsOpen ? " is-open" : ""}`}>
          <button type="button" className="workshop-materials-toggle btn-ghost" aria-expanded={materialsOpen} aria-controls="workshop-materials" onClick={() => setMaterialsOpen((open) => !open)}>
            <Layers size={15} /> Материалы кампании <ChevronDown size={15} />
          </button>
          <div id="workshop-materials" className="workshop-materials">
            <WorkshopProposals />
            <WorldSummary />
            <RecentlyCreated documents={documents} />
          </div>
        </div>
      </div>
    </div>
  );
}
