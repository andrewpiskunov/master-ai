import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CampaignWorkspace } from "./CampaignWorkspace.js";
import { KnowledgeBase } from "./KnowledgeBase.js";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";

vi.mock("../../api/client.js");
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={<CampaignWorkspace />}>
            <Route path="knowledge" element={<KnowledgeBase />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("CampaignWorkspace + KnowledgeBase", () => {
  it("показывает название кампании в сайдбаре и документы базы знаний", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({
      id: "c1", name: "Город Солнца", system: null, description: null, createdAt: "x",
    });
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([
      { id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x" },
    ]);
    vi.mocked(api.search).mockResolvedValue([]);

    renderAt("/campaigns/c1/knowledge");

    // название кампании — в сайдбаре
    expect(await screen.findByText("Город Солнца")).toBeInTheDocument();
    // документ-NPC попал в базу знаний
    expect(await screen.findByText("Барон")).toBeInTheDocument();
    // навигация присутствует
    expect(screen.getByRole("link", { name: /база знаний/i })).toBeInTheDocument();
  });
});
