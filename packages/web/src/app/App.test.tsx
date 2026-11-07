import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { App } from "./App.js";

vi.mock("../api/client.js", () => ({
  api: {
    listCampaigns: vi.fn().mockResolvedValue([]),
    llmUsageGlobal: vi.fn().mockResolvedValue({
      total: { promptTokens: 0, completionTokens: 0, requests: 0, estimated: false, avgDurationMs: 0 },
      byFeature: [], byModel: [], byCampaign: [],
    }),
  },
  ApiError: class extends Error {},
}));

describe("App", () => {
  it("рендерит заголовок приложения на главной", async () => {
    render(<App />);
    expect(await screen.findByText("MasterAI")).toBeInTheDocument();
  });
});
