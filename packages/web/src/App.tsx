import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "./pages/HomePage.js";
import { CampaignPage } from "./pages/CampaignPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/campaigns/:campaignId" element={<CampaignPage />} />
      </Routes>
    </BrowserRouter>
  );
}
