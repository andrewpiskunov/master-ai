import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPage } from "./DocumentPage.js";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";

vi.mock("../../api/client.js");
vi.mock("../../api/stream.js");
beforeEach(() => vi.resetAllMocks());
beforeEach(() => {
  vi.mocked(api.listDocumentLinks).mockResolvedValue({ outgoing: [], incoming: [] });
  vi.mocked(api.listCampaignDocuments).mockResolvedValue([]);
  vi.mocked(api.getDocumentConversation).mockResolvedValue([]);
});

function renderAt(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/documents/${id}`]}>
        <Routes>
          <Route path="/documents/:documentId" element={<DocumentPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("DocumentPage", () => {
  it("автоматически сохраняет изменения title", async () => {
    vi.mocked(api.getDocument).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: "active",
      contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "x",
    });
    vi.mocked(api.updateDocument).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон фон Кройц", status: "active",
      contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "y",
    });
    renderAt("d1");
    const title = await screen.findByLabelText(/заголовок/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Барон фон Кройц");
    // Кнопки «Сохранить» больше нет — сохранение происходит само, с задержкой.
    expect(screen.queryByRole("button", { name: /сохранить/i })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.updateDocument).toHaveBeenCalledWith(
        "d1",
        expect.objectContaining({ title: "Барон фон Кройц" }),
      ),
    );
  });
});
