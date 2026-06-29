import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPage } from "./DocumentPage.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js");
beforeEach(() => vi.resetAllMocks());

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/documents/${id}`]}>
      <Routes>
        <Route path="/documents/:documentId" element={<DocumentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DocumentPage", () => {
  it("грузит документ и сохраняет изменения title", async () => {
    vi.mocked(api.getDocument).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: "alive",
      contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "x",
    });
    vi.mocked(api.updateDocument).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон фон Кройц", status: "alive",
      contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "y",
    });
    renderAt("d1");
    const title = await screen.findByLabelText(/заголовок/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Барон фон Кройц");
    await userEvent.click(screen.getByRole("button", { name: /сохранить/i }));
    await waitFor(() =>
      expect(api.updateDocument).toHaveBeenCalledWith(
        "d1",
        expect.objectContaining({ title: "Барон фон Кройц" }),
      ),
    );
  });
});
