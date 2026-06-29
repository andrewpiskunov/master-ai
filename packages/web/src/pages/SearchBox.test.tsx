import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SearchBox } from "./SearchBox.js";
import { ToastProvider } from "../ui/toast.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  api: { search: vi.fn() },
  ApiError: class extends Error {},
}));

beforeEach(() => vi.clearAllMocks());

function renderBox() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <SearchBox campaignId="c1" />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("SearchBox", () => {
  it("показывает результаты поиска", async () => {
    (api.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { docId: "d1", type: "npc", title: "Барон", snippet: "…аристократ…" },
    ]);
    renderBox();
    await userEvent.type(screen.getByPlaceholderText(/поиск/i), "барон");
    expect(await screen.findByText("Барон")).toBeInTheDocument();
    expect(api.search).toHaveBeenCalledWith("c1", "барон");
  });
});
