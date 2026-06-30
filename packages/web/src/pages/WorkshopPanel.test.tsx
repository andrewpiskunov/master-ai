import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "../ui/toast.js";
import { WorkshopPanel, WorkshopProposals } from "./WorkshopPanel.js";
import { WorkshopChatProvider } from "./campaign/WorkshopChatContext.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js");
beforeEach(() => vi.resetAllMocks());

function renderPanel(onApproved = vi.fn()) {
  return render(
    <ToastProvider>
      <WorkshopChatProvider campaignId="c1" onApproved={onApproved}>
        <WorkshopPanel />
        <WorkshopProposals />
      </WorkshopChatProvider>
    </ToastProvider>,
  );
}

describe("WorkshopPanel", () => {
  it("отправляет сообщение и показывает предложение, принимает его", async () => {
    vi.mocked(api.getConversation).mockResolvedValue([]);
    vi.mocked(api.listProposals).mockResolvedValue([]);
    vi.mocked(api.brainstorm).mockResolvedValue({
      conversationId: "k1",
      reply: "Вот злодей.",
      proposals: [{ id: "p1", campaignId: "c1", conversationId: "k1", type: "npc", title: "Барон", content: "Мрачный.", fields: {}, action: "create", status: "pending", createdAt: "x" }],
    });
    vi.mocked(api.approveProposal).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x",
    });
    const onApproved = vi.fn();
    renderPanel(onApproved);

    await userEvent.type(screen.getByLabelText(/сообщение/i), "придумай злодея");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));

    expect(await screen.findByText("Вот злодей.")).toBeInTheDocument();
    expect(await screen.findByText("Барон")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /принять/i }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1"));
    expect(onApproved).toHaveBeenCalled();
  });
});
