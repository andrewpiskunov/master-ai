import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CampaignPage } from "./CampaignPage.js";
import { api } from "../api/client.js";
import { ToastProvider } from "../ui/toast.js";

vi.mock("../api/client.js");
const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateMock,
}));

beforeEach(() => vi.resetAllMocks());

function renderAt(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/campaigns/${id}`]}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={<CampaignPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("CampaignPage", () => {
  it("показывает название кампании и документы по группам типов", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({
      id: "c1", name: "Город Солнца", system: null, description: null, createdAt: "x",
    });
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([
      { id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x" },
    ]);
    renderAt("c1");
    expect(await screen.findByText("Город Солнца")).toBeInTheDocument();
    expect(screen.getByText("Барон")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NPC" })).toBeInTheDocument(); // label группы типа npc
  });
});
