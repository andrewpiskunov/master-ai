import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { App } from "./App.js";

vi.mock("./api/client.js", () => ({
  api: { listCampaigns: vi.fn().mockResolvedValue([]) },
  ApiError: class extends Error {},
}));

describe("App", () => {
  it("рендерит заголовок приложения на главной", async () => {
    render(<App />);
    expect(await screen.findByText("MasterAI")).toBeInTheDocument();
  });
});
