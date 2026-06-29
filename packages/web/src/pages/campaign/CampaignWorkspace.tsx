import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Home, Lightbulb, BookOpen, Layers, Plus } from "lucide-react";
import { type Campaign, type Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { useToast } from "../../ui/toast.js";
import { SearchBox } from "../SearchBox.js";
import type { CampaignContext } from "./shared.js";

export function CampaignWorkspace() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);

  const reload = useCallback(() => {
    if (!campaignId) return;
    api.listCampaignDocuments(campaignId).then(setDocuments).catch(() => showToast("Не удалось загрузить документы"));
  }, [campaignId, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    api.getCampaign(campaignId).then(setCampaign).catch(() => showToast("Не удалось загрузить кампанию"));
    reload();
  }, [campaignId, reload, showToast]);

  const createDocument = useCallback(
    async (type: string) => {
      if (!campaignId) return;
      try {
        const doc = await api.createDocument({ campaignId, type, title: "Без названия" });
        navigate(`/documents/${doc.id}`);
      } catch {
        showToast("Не удалось создать документ");
      }
    },
    [campaignId, navigate, showToast],
  );

  const ctx: CampaignContext = { campaignId: campaignId!, campaign, documents, reload, createDocument };

  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link to="/" className="ws-campaign">
          <span className="ws-campaign-name">{campaign?.name ?? "…"}</span>
          <span className="ws-campaign-sub">Кампания</span>
        </Link>

        <nav className="ws-nav">
          <NavLink end to={`/campaigns/${campaignId}`}><Home size={18} strokeWidth={1.8} /> Обзор</NavLink>
          <NavLink to={`/campaigns/${campaignId}/workshop`}><Lightbulb size={18} strokeWidth={1.8} /> Мастерская</NavLink>
          <NavLink to={`/campaigns/${campaignId}/knowledge`}><BookOpen size={18} strokeWidth={1.8} /> База знаний</NavLink>
          <NavLink to={`/campaigns/${campaignId}/play`}><Layers size={18} strokeWidth={1.8} /> Игровые материалы</NavLink>
        </nav>

        <div className="ws-search">
          <SearchBox campaignId={campaignId!} />
        </div>

        <div className="ws-foot">
          <button type="button" className="ws-new" onClick={() => createDocument("note")}>
            <Plus size={18} strokeWidth={2} /> Новый документ
          </button>
        </div>
      </aside>

      <div className="workspace-main">
        <Outlet context={ctx} />
      </div>
    </div>
  );
}
