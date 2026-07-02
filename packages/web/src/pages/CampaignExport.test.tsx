import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Document } from "@master-ai/shared";
import { CampaignExport } from "./CampaignExport.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js");

function doc(id: string, title: string): Document {
  return { id, campaignId: "c1", type: "npc", title, status: null, contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "x" };
}

describe("CampaignExport (smoke)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("выводит имя кампании, число документов и их названия", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({ id: "c1", name: "Корона", system: null, description: "", realism: "balanced", createdAt: "x" });
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([doc("d1", "Барон"), doc("d2", "Причал")]);
    render(
      <MemoryRouter initialEntries={["/campaigns/c1/export"]}>
        <Routes><Route path="/campaigns/:campaignId/export" element={<CampaignExport />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Корона" })).toBeInTheDocument());
    expect(screen.getByText("2 документа")).toBeInTheDocument();
    expect(screen.getByText("Барон")).toBeInTheDocument();
    expect(screen.getByText("Причал")).toBeInTheDocument();
  });
});
