import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HomePage } from "./HomePage.js";
import { api } from "../api/client.js";
import { ToastProvider } from "../ui/toast.js";

vi.mock("../api/client.js");
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("HomePage", () => {
  it("показывает загруженные кампании", async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue([
      { id: "c1", name: "Город Солнца", system: null, description: null, realism: "balanced", llmProvider: "cli" as const, llmSettings: {}, createdAt: "2026-06-28T22:04:00.000Z" },
    ]);
    renderPage();
    expect(await screen.findByText("Город Солнца")).toBeInTheDocument();
  });

  it("показывает тост при ошибке загрузки кампаний", async () => {
    vi.mocked(api.listCampaigns).mockRejectedValue(new Error("сеть упала"));
    renderPage();
    expect(await screen.findByText(/не удалось загрузить кампании/i)).toBeInTheDocument();
  });

  it("без кампаний показывает экран приветствия и создаёт первую", async () => {
    vi.mocked(api.listCampaigns).mockResolvedValue([]);
    vi.mocked(api.createCampaign).mockResolvedValue({
      id: "c2", name: "Новая", system: null, description: null, realism: "balanced", llmProvider: "cli" as const, llmSettings: {}, createdAt: "x",
    });
    renderPage();
    expect(await screen.findByText(/создадим первую кампанию/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/название кампании/i), "Новая");
    await userEvent.click(screen.getByRole("button", { name: /создать кампанию/i }));
    await waitFor(() => expect(api.createCampaign).toHaveBeenCalledWith({ name: "Новая" }));
  });
});
