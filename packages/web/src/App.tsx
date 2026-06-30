import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage.js";
import { DocumentPage } from "./pages/DocumentPage.js";
import { PrintReader } from "./pages/PrintReader.js";
import { PlaySession } from "./pages/PlaySession.js";
import { CampaignWorkspace } from "./pages/campaign/CampaignWorkspace.js";
import { CampaignHome } from "./pages/campaign/CampaignHome.js";
import { WorkshopView } from "./pages/campaign/WorkshopView.js";
import { KnowledgeBase } from "./pages/campaign/KnowledgeBase.js";
import { PlayMaterials } from "./pages/campaign/PlayMaterials.js";
import { ManageCampaign } from "./pages/campaign/ManageCampaign.js";
import { Layout } from "./ui/Layout.js";
import { ToastProvider } from "./ui/toast.js";

export function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/campaigns/:campaignId" element={<CampaignWorkspace />}>
              <Route index element={<CampaignHome />} />
              <Route path="workshop" element={<WorkshopView />} />
              <Route path="knowledge" element={<KnowledgeBase />} />
              <Route path="play" element={<PlayMaterials />} />
              <Route path="manage" element={<ManageCampaign />} />
              <Route path="documents/:documentId" element={<DocumentPage />} />
            </Route>
          </Route>
          <Route path="/campaigns/:campaignId/documents/:documentId/print" element={<PrintReader />} />
          <Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
