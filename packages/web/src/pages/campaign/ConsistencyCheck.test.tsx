import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsistencyCheck } from "./ConsistencyCheck.js";
import { api } from "../../api/client.js";

vi.mock("../../api/client.js");

describe("ConsistencyCheck (smoke)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("запускает проверку и показывает найденное противоречие", async () => {
    vi.mocked(api.checkConsistency).mockResolvedValue({
      issues: [{ documents: ["«A»", "«B»"], contradiction: "A мёртв, но действует", fix: "уточнить статус" }],
    });
    render(<MemoryRouter><ConsistencyCheck campaignId="c1" documents={[]} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /Проверить на противоречия/ }));
    await waitFor(() => expect(screen.getByText(/A мёртв, но действует/)).toBeInTheDocument());
  });

  it("показывает «не найдено», когда противоречий нет", async () => {
    vi.mocked(api.checkConsistency).mockResolvedValue({ issues: [] });
    render(<MemoryRouter><ConsistencyCheck campaignId="c1" documents={[]} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: /Проверить на противоречия/ }));
    await waitFor(() => expect(screen.getByText(/Явных противоречий не найдено/)).toBeInTheDocument());
  });
});
