import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../../app/App.js";
import { api } from "../../api/client.js";

vi.mock("../../api/client.js", () => ({ api: { listCampaigns: vi.fn() }, ApiError: class extends Error {} }));
afterEach(() => { window.history.replaceState(null, "", "/"); });

describe("standalone player route", () => {
  it("opens outside the campaign layout and never loads campaign materials", () => {
    window.history.replaceState(null, "", "/player-screen/13ad6605-4bb6-4678-82b6-dcc9dca5511b");
    render(<App />);
    expect(screen.getByRole("button", { name: "Полный экран" })).toBeInTheDocument();
    expect(screen.queryByText("MasterAI")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(api.listCampaigns).not.toHaveBeenCalled();
  });
});
