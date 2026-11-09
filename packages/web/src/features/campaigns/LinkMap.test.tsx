import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { LinkMap } from "./LinkMap.js";

vi.mock("../../api/client.js", () => ({ api: { listCampaignLinks: vi.fn() } }));
beforeEach(() => { vi.mocked(api.listCampaignLinks).mockResolvedValue([]); });
function doc(id: string, title: string, bodyText = "", type = "npc"): Document {
  return { id, campaignId: "c1", type, title, status: null,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: bodyText ? [{ type: "text", text: bodyText }] : [] }] },
    fields: {}, createdAt: "x", updatedAt: "x" };
}
async function renderMap(documents: Document[], reload = vi.fn()) {
  render(<MemoryRouter initialEntries={["/map"]}><Routes><Route element={<Outlet context={{ campaignId: "c1", campaign: null, documents, reload }} />}>
    <Route path="/map" element={<LinkMap />} /><Route path="/campaigns/c1/documents/:id" element={<p>Открытая карточка</p>} />
  </Route></Routes></MemoryRouter>);
  await act(async () => {});
  return reload;
}
const node = (title: string) => screen.getByRole("button", { name: `Выбрать: ${title}` });
describe("LinkMap explorer", () => {
  it("shows documents and refreshes campaign data on entry", async () => {
    const reload = await renderMap([doc("a", "Барон"), doc("b", "Причал", "Барон приходит сюда", "location")]);
    expect(node("Барон")).toBeInTheDocument(); expect(node("Причал")).toBeInTheDocument();
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });
  it("searches body text, keeps neighbors on request, and removes hidden types", async () => {
    await renderMap([doc("a", "Барон", "Серебряный кинжал. Причал"), doc("b", "Причал", "", "location"), doc("c", "Отшельник")]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "серебряный" } });
    expect(node("Барон")).toBeInTheDocument(); expect(node("Причал")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать: Отшельник" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Связи найденного" }));
    expect(screen.queryByRole("button", { name: "Выбрать: Причал" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /NPC 2/ }));
    expect(screen.queryByRole("button", { name: "Выбрать: Барон" })).not.toBeInTheDocument();
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });
  it("inspects relationship evidence and opens a real document link", async () => {
    await renderMap([doc("a", "Барон", "Ночью Барон посещает Причал."), doc("b", "Причал", "", "location")]);
    fireEvent.click(node("Барон"));
    const inspector = screen.getByRole("region", { name: "Выбранная сущность" });
    expect(within(inspector).getByText(/Упоминает/)).toBeInTheDocument();
    expect(within(inspector).getByRole("link", { name: /Открыть карточку/ })).toHaveAttribute("href", "/campaigns/c1/documents/a");
    fireEvent.click(within(inspector).getByRole("link", { name: /Открыть карточку/ }));
    expect(screen.getByText("Открытая карточка")).toBeInTheDocument();
  });
  it("focuses one or two steps away without confusing unrelated entities", async () => {
    await renderMap([doc("a", "Барон", "Причал"), doc("b", "Причал", "Башня", "location"), doc("c", "Башня", "", "location"), doc("d", "Отшельник")]);
    fireEvent.click(node("Барон")); fireEvent.click(screen.getByRole("button", { name: "Только связи этой сущности" }));
    expect(node("Барон")).toBeInTheDocument(); expect(node("Причал")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать: Башня" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 шага" }));
    expect(node("Башня")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Вся карта" }));
    expect(node("Отшельник")).toBeInTheDocument();
  });
  it("includes explicit relationships with their labels", async () => {
    vi.mocked(api.listCampaignLinks).mockResolvedValue([{ id: "r", campaignId: "c1", fromDocId: "a", toDocId: "b", kind: "владеет" }]);
    await renderMap([doc("a", "Барон"), doc("b", "Причал", "", "location")]);
    fireEvent.click(node("Барон"));
    expect(await screen.findByText("владеет")).toBeInTheDocument();
  });
  it("reveals a related entity hidden by search or type filters when selected in the inspector", async () => {
    await renderMap([doc("a", "Барон", "Причал"), doc("b", "Причал", "", "location")]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Барон" } });
    fireEvent.click(screen.getByRole("button", { name: /Локация 1/ }));
    fireEvent.click(node("Барон"));
    const inspector = screen.getByRole("region", { name: "Выбранная сущность" });
    fireEvent.click(within(inspector).getByRole("button", { name: /Причал/ }));
    expect(within(screen.getByRole("region", { name: "Выбранная сущность" })).getByRole("heading", { name: "Причал" })).toBeInTheDocument();
    expect(node("Причал")).toBeInTheDocument();
  });
  it("hides isolated nodes and can reset every filter", async () => {
    await renderMap([doc("a", "Барон", "Причал"), doc("b", "Причал", "", "location"), doc("c", "Отшельник")]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Без связей" }));
    expect(screen.queryByRole("button", { name: "Выбрать: Отшельник" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(node("Отшельник")).toBeInTheDocument();
  });
});
