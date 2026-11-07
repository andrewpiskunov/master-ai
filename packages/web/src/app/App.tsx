import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "../features/campaigns/HomePage.js";
import { DocumentPage } from "../features/documents/DocumentPage.js";
import { PrintReader } from "../features/documents/PrintReader.js";
import { PlaySession } from "../features/play/PlaySession.js";
import { PlayerScreen } from "../features/play/PlayerScreen.js";
import { CampaignExport } from "../features/campaigns/CampaignExport.js";
import { CampaignWorkspace } from "../features/campaigns/CampaignWorkspace.js";
import { CampaignHome } from "../features/campaigns/CampaignHome.js";
import { WorkshopView } from "../features/assistant/WorkshopView.js";
import { KnowledgeBase } from "../features/campaigns/KnowledgeBase.js";
import { PlayMaterials } from "../features/play/PlayMaterials.js";
import { ManageCampaign } from "../features/campaigns/ManageCampaign.js";
import { LinkMap } from "../features/campaigns/LinkMap.js";
import { Layout } from "../ui/Layout.js";
import { ToastProvider } from "../ui/toast.js";

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignWorkspace />}>
              <Route index element={<CampaignHome />} />
              <Route path="workshop" element={<WorkshopView />} />
              <Route path="knowledge" element={<KnowledgeBase />} />
              <Route path="play" element={<PlayMaterials />} />
              <Route path="manage" element={<ManageCampaign />} />
              <Route path="map" element={<LinkMap />} />
              <Route path="documents/:documentId" element={<DocumentPage />} />
            </Route>
          </Route>
          <Route path="/campaigns/:campaignId/documents/:documentId/print" element={<PrintReader />} />
          <Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} />
          <Route path="/player-screen/:channelId" element={<PlayerScreen />} />
          <Route path="/campaigns/:campaignId/export" element={<CampaignExport />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
