import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Campaign, ImageAttachment } from "@master-ai/shared";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HomePage } from "./HomePage.js";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";

vi.mock("../../api/client.js");

const map: ImageAttachment = { id: "img-map", name: "Карта гавани.png", mimeType: "image/png" };
function campaign(overrides: Partial<Campaign> & { updatedAt?: string; cover?: ImageAttachment | null } = {}): Campaign {
  return { id: "c1", name: "Город Солнца", system: null, description: null, realism: "balanced", llmProvider: "cli", llmSettings: {}, createdAt: "2026-06-28T22:04:00.000Z", ...overrides };
}
const catalog = [
  campaign({ id: "c1", name: "Город Солнца", system: "D&D 5e", description: "Тайна затонувшей гавани", createdAt: "2026-06-20T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z", cover: map }),
  campaign({ id: "c2", name: "Янтарная луна", system: "Fate", description: "Звёздный тракт", createdAt: "2026-10-20T00:00:00.000Z" }),
  campaign({ id: "c3", name: "Безымянный лес", createdAt: "2026-08-20T00:00:00.000Z" }),
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listCampaigns).mockResolvedValue(catalog);
  vi.mocked(api.llmUsageGlobal).mockResolvedValue({
    total: { promptTokens: 0, completionTokens: 0, requests: 0, estimated: false, avgDurationMs: 0 },
    byFeature: [], byModel: [], byCampaign: [],
  });
});

function renderPage() {
  return render(<ToastProvider><MemoryRouter><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/campaigns/:id" element={<h1>Открыта кампания</h1>} />
  </Routes></MemoryRouter></ToastProvider>);
}
function visibleCampaigns() {
  return within(screen.getByRole("list", { name: "Кампании" })).getAllByRole("link").map((link) => link.getAttribute("href"));
}

describe("HomePage", () => {
  it("показывает обложку, систему и описание; сортирует по последней активности", async () => {
    renderPage();
    expect(await screen.findByText("Город Солнца")).toBeInTheDocument();
    expect(visibleCampaigns()).toEqual(["/campaigns/c1", "/campaigns/c2", "/campaigns/c3"]);
    expect(screen.getByAltText("Обложка кампании «Город Солнца»")).toHaveAttribute("src", "/api/images/img-map");
    expect(within(screen.getByRole("list", { name: "Кампании" })).getByText("D&D 5e")).toBeInTheDocument();
    expect(screen.getByText("Тайна затонувшей гавани")).toBeInTheDocument();
  });

  it.each(["  ГОРОД  ", "ГАВАНИ", "d&d 5E"])("ищет по названию, описанию и системе без учёта регистра: %s", async (query) => {
    renderPage();
    await screen.findByText("Город Солнца");
    await userEvent.type(screen.getByRole("searchbox", { name: /поиск кампаний/i }), query);
    expect(visibleCampaigns()).toEqual(["/campaigns/c1"]);
  });

  it("фильтрует по системе, включая кампании без системы", async () => {
    renderPage();
    await screen.findByText("Город Солнца");
    await userEvent.selectOptions(screen.getByLabelText("Игровая система"), "Fate");
    expect(visibleCampaigns()).toEqual(["/campaigns/c2"]);
    await userEvent.selectOptions(screen.getByLabelText("Игровая система"), "__unspecified");
    expect(visibleCampaigns()).toEqual(["/campaigns/c3"]);
  });

  it("сортирует по дате создания и по русскому алфавиту", async () => {
    renderPage();
    await screen.findByText("Город Солнца");
    await userEvent.selectOptions(screen.getByLabelText("Порядок кампаний"), "created");
    expect(visibleCampaigns()).toEqual(["/campaigns/c2", "/campaigns/c3", "/campaigns/c1"]);
    await userEvent.selectOptions(screen.getByLabelText("Порядок кампаний"), "name");
    expect(visibleCampaigns()).toEqual(["/campaigns/c3", "/campaigns/c1", "/campaigns/c2"]);
  });

  it("показывает пустой результат и сбрасывает поиск вместе с фильтром", async () => {
    renderPage();
    await screen.findByText("Город Солнца");
    await userEvent.selectOptions(screen.getByLabelText("Игровая система"), "Fate");
    await userEvent.type(screen.getByRole("searchbox"), "гавань");
    expect(screen.getByText("Кампании не найдены")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByLabelText("Игровая система")).toHaveValue("all");
    expect(visibleCampaigns()).toHaveLength(3);
  });

  it("открывает кампанию по карточке", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("link", { name: "Город Солнца" }));
    expect(screen.getByRole("heading", { name: "Открыта кампания" })).toBeInTheDocument();
  });

  it("меняет обложку из отдельной кнопки карточки без перехода в кампанию", async () => {
    vi.mocked(api.campaignImages).mockResolvedValue([map]);
    vi.mocked(api.setCampaignCover).mockResolvedValue(campaign({ cover: null }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Изменить обложку «Город Солнца»" }));
    expect(await screen.findByRole("dialog", { name: /обложка кампании/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Убрать обложку" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByAltText("Обложка кампании «Город Солнца»")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Кампании" })).toBeInTheDocument();
  });

  it("показывает тост при ошибке загрузки кампаний", async () => {
    vi.mocked(api.listCampaigns).mockRejectedValue(new Error("сеть упала"));
    renderPage();
    expect(await screen.findByText(/не удалось загрузить кампании/i)).toBeInTheDocument();
  });

  it("без кампаний показывает экран приветствия и создаёт первую", async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue([]);
    vi.mocked(api.createCampaign).mockResolvedValue(campaign({ id: "c4", name: "Новая" }));
    renderPage();
    expect(await screen.findByText(/создадим первую кампанию/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/название кампании/i), "  Новая  ");
    await userEvent.click(screen.getByRole("button", { name: /создать кампанию/i }));
    expect(await screen.findByRole("heading", { name: "Открыта кампания" })).toBeInTheDocument();
    expect(api.createCampaign).toHaveBeenCalledWith({ name: "Новая" });
  });

  it("создаёт кампанию из каталога и позволяет повторить после ошибки", async () => {
    vi.mocked(api.createCampaign).mockRejectedValueOnce(new Error("сеть")).mockResolvedValueOnce(campaign({ id: "c4", name: "Новая" }));
    renderPage();
    await screen.findByText("Город Солнца");
    await userEvent.click(screen.getByRole("button", { name: "Новая кампания" }));
    await userEvent.type(screen.getByLabelText("Название кампании"), "Новая");
    await userEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(await screen.findByText("Не удалось создать кампанию")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(await screen.findByRole("heading", { name: "Открыта кампания" })).toBeInTheDocument();
  });
});
