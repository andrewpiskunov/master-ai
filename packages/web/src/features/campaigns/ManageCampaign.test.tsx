import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "@master-ai/shared";
import { ManageCampaign } from "./ManageCampaign.js";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";

const { useCampaignMock } = vi.hoisted(() => ({ useCampaignMock: vi.fn() }));
vi.mock("./shared.js", () => ({ useCampaign: useCampaignMock }));
vi.mock("../../api/client.js", () => ({
  api: { llmUsage: vi.fn(), llmConfig: vi.fn() },
}));

const campaign: Campaign = {
  id: "c1", name: "Тестовая кампания", system: null, description: null,
  realism: "balanced", llmProvider: "cli", llmSettings: {}, createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  useCampaignMock.mockReturnValue({ campaignId: "c1", campaign, reloadCampaign: vi.fn() });
  vi.mocked(api.llmUsage).mockResolvedValue({
    total: { requests: 0, promptTokens: 0, completionTokens: 0, estimated: false, avgDurationMs: 0 },
    byFeature: [], byModel: [],
  });
  vi.mocked(api.llmConfig).mockResolvedValue({ cli: { name: "Codex", command: "codex" } });
});

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ManageCampaign />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("ManageCampaign: фактический CLI", () => {
  it("показывает Codex и его команду вместо жёстко заданного Claude", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "Codex (CLI)" })).toHaveClass("active");
    expect(screen.getByText(/командой «codex»/)).toBeInTheDocument();
    expect(screen.queryByText(/Claude/)).not.toBeInTheDocument();
  });

  it("называет Codex запасным провайдером при пустом API-ключе", async () => {
    useCampaignMock.mockReturnValue({
      campaignId: "c1", campaign: { ...campaign, llmProvider: "openai" }, reloadCampaign: vi.fn(),
    });
    renderPage();
    expect(await screen.findByText(/Пока ключ не заполнен, используется Codex\./)).toBeInTheDocument();
  });

  it("при недоступной конфигурации показывает общий CLI без ложного названия", async () => {
    vi.mocked(api.llmConfig).mockRejectedValue(new Error("network unavailable"));
    renderPage();
    expect(await screen.findByText("Локальный CLI, настроенный на сервере.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Локальный CLI" })).toBeInTheDocument();
    expect(screen.queryByText(/Claude/)).not.toBeInTheDocument();
  });

  it("не помечает все CLI-запросы в истории как Claude Code", async () => {
    vi.mocked(api.llmUsage).mockResolvedValue({
      total: { requests: 2, promptTokens: 20, completionTokens: 10, estimated: true, avgDurationMs: 100 },
      byFeature: [],
      byModel: [
        { provider: "cli", model: "codex", requests: 1, promptTokens: 10, completionTokens: 5, avgDurationMs: 100 },
        { provider: "cli", model: "claude", requests: 1, promptTokens: 10, completionTokens: 5, avgDurationMs: 100 },
      ],
    });
    renderPage();
    expect(await screen.findByRole("cell", { name: "codex" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "claude" })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "CLI" })).toHaveLength(2);
    expect(screen.queryByRole("cell", { name: "Claude Code (CLI)" })).not.toBeInTheDocument();
  });
});
