import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LinksPanel } from "./LinksPanel.js";
import { ToastProvider } from "../ui/toast.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  api: {
    listDocumentLinks: vi.fn(),
    listCampaignDocuments: vi.fn(),
    createLink: vi.fn(),
    deleteLink: vi.fn(),
  },
  ApiError: class extends Error {},
}));

beforeEach(() => vi.clearAllMocks());

function renderPanel() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <LinksPanel campaignId="c1" documentId="a" />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("LinksPanel", () => {
  it("показывает исходящие и обратные связи", async () => {
    (api.listDocumentLinks as ReturnType<typeof vi.fn>).mockResolvedValue({
      outgoing: [{ linkId: "l1", kind: "обитает в", document: { id: "b", type: "location", title: "Замок" } }],
      incoming: [{ linkId: "l2", kind: "знает", document: { id: "c", type: "npc", title: "Шпион" } }],
    });
    (api.listCampaignDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("Замок")).toBeInTheDocument();
    expect(await screen.findByText("Шпион")).toBeInTheDocument();
  });

  it("удаляет связь по кнопке", async () => {
    (api.listDocumentLinks as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        outgoing: [{ linkId: "l1", kind: "обитает в", document: { id: "b", type: "location", title: "Замок" } }],
        incoming: [],
      })
      .mockResolvedValueOnce({ outgoing: [], incoming: [] });
    (api.listCampaignDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.deleteLink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText("Замок");
    await userEvent.click(screen.getByRole("button", { name: /удалить/i }));
    await waitFor(() => expect(api.deleteLink).toHaveBeenCalledWith("l1"));
  });
});
