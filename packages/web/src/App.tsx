import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage.js";
import { CampaignPage } from "./pages/CampaignPage.js";
import { DocumentPage } from "./pages/DocumentPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/campaigns/:campaignId" element={<CampaignPage />} />
        <Route path="/documents/:documentId" element={<DocumentPage />} />
      </Routes>
    </BrowserRouter>
  );
}
