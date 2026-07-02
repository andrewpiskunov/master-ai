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
  it("отправляет сообщение через серверную задачу, показывает предложение и принимает его", async () => {
    // до отправки беседа с приветствием; после завершения задачи — с ответом
    vi.mocked(api.getConversation)
      .mockResolvedValueOnce([{ id: "w", role: "assistant", content: "Привет!", createdAt: "x" }])
      .mockResolvedValue([
        { id: "w", role: "assistant", content: "Привет!", createdAt: "x" },
        { id: "u", role: "user", content: "придумай злодея", createdAt: "x" },
        { id: "a", role: "assistant", content: "Вот злодей.", createdAt: "x" },
      ]);
    vi.mocked(api.listProposals)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: "p1", campaignId: "c1", conversationId: "k1", type: "npc", title: "Барон", content: "Мрачный.", fields: {}, action: "create", status: "pending", createdAt: "x" }]);
    vi.mocked(api.worldSummary).mockResolvedValue({ summary: "", question: "" });
    // при монтировании генерация не идёт; после старта задача мгновенно завершена
    vi.mocked(api.brainstormStatus).mockResolvedValue({ running: false, partial: "", error: null });
    vi.mocked(api.startBrainstorm).mockResolvedValue({ started: true });
    vi.mocked(api.approveProposal).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x",
    });
    const onApproved = vi.fn();
    renderPanel(onApproved);

    await userEvent.type(screen.getByLabelText(/сообщение/i), "придумай злодея");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));

    expect(api.startBrainstorm).toHaveBeenCalledWith("c1", "придумай злодея");
    expect(await screen.findByText("Вот злодей.")).toBeInTheDocument();
    expect(await screen.findByText("Барон")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /принять/i }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1"));
    expect(onApproved).toHaveBeenCalled();
  });
});
