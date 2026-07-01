import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import type { Document } from "@master-ai/shared";
import { LinkMap } from "./LinkMap.js";

function doc(id: string, title: string, bodyText = ""): Document {
  return {
    id, campaignId: "c1", type: "npc", title, status: null,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: bodyText ? [{ type: "text", text: bodyText }] : [] }] },
    fields: {}, createdAt: "x", updatedAt: "x",
  };
}

function renderMap(documents: Document[], reload = vi.fn()) {
  const ctx = { campaignId: "c1", campaign: null, documents, reload };
  render(
    <MemoryRouter initialEntries={["/map"]}>
      <Routes>
        <Route element={<Outlet context={ctx} />}>
          <Route path="/map" element={<LinkMap />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return reload;
}

describe("LinkMap (smoke)", () => {
  it("рисует узлы документов и обновляет данные при открытии", async () => {
    const reload = renderMap([doc("d1", "Барон"), doc("d2", "Причал", "Тут бывает Барон.")]);
    expect(screen.getByText("Барон")).toBeInTheDocument();
    expect(screen.getByText("Причал")).toBeInTheDocument();
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
});
