import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";
import { WorkshopChatProvider } from "./WorkshopChatContext.js";
import { WorkshopPanel, WorkshopProposals, WorldSummary } from "./WorkshopPanel.js";

vi.mock("../../api/client.js");
const history: ConversationMessage[] = [
  { id: "u", role: "user", content: "Старая тема", createdAt: "x" },
  { id: "a", role: "assistant", content: "Прежний ответ", createdAt: "x" },
];
const marker: ConversationMessage = { id: "topic", role: "assistant", content: "", meta: { workshopTopicStart: true }, createdAt: "y" };

function Workshop({ campaignId = "c1" }: { campaignId?: string }) {
  return <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ToastProvider>
    <WorkshopChatProvider campaignId={campaignId} onApproved={vi.fn()}>
      <WorkshopPanel /><WorkshopProposals /><WorldSummary />
    </WorkshopChatProvider>
  </ToastProvider></MemoryRouter>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getConversation).mockResolvedValue(history);
  vi.mocked(api.listProposals).mockResolvedValue([{ id: "p", campaignId: "c1", conversationId: "conv", title: "Черновик башни", type: "location", content: "Каменная башня.", fields: {}, action: "create", status: "pending", createdAt: "x" }]);
  vi.mocked(api.brainstormStatus).mockResolvedValue({ running: false, partial: "", error: null });
  vi.mocked(api.startWorkshopTopic).mockResolvedValue(marker);
  vi.mocked(api.worldSummary).mockResolvedValue({ summary: "Сводка прежней темы", question: "Старый вопрос?" });
});

describe("workshop topic controls", () => {
  it("starts a topic without removing history or proposals and resets the world summary", async () => {
    render(<Workshop />);
    await screen.findByText("Сводка прежней темы");
    await userEvent.type(screen.getByRole("textbox", { name: "Сообщение" }), "Черновик нового вопроса");
    await userEvent.click(screen.getByRole("button", { name: "Новая тема" }));

    expect(await screen.findByRole("separator", { name: "Новая тема" })).toBeInTheDocument();
    expect(screen.getByText("Старая тема")).toBeInTheDocument();
    expect(screen.getByText("Прежний ответ")).toBeInTheDocument();
    expect(screen.getByText("Черновик башни")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Сообщение" })).toHaveValue("Черновик нового вопроса");
    expect(screen.queryByText("Сводка прежней темы")).not.toBeInTheDocument();
    expect(screen.queryByText("Старый вопрос?")).not.toBeInTheDocument();
    expect(api.startWorkshopTopic).toHaveBeenCalledWith("c1");
    expect(api.startBrainstorm).not.toHaveBeenCalled();
    expect(api.worldSummary).toHaveBeenCalledTimes(1);
  });

  it("renders persisted topic dividers and does not summarize old topics on reload", async () => {
    vi.mocked(api.getConversation).mockResolvedValue([...history, marker]);
    render(<Workshop />);
    expect(await screen.findByRole("separator", { name: "Новая тема" })).toBeInTheDocument();
    expect(screen.getByText("Старая тема")).toBeInTheDocument();
    expect(api.worldSummary).not.toHaveBeenCalled();
    expect(screen.queryByText("Мир кампании")).not.toBeInTheDocument();
    expect(screen.getByText(/напишите первый вопрос новой темы/i)).toBeInTheDocument();
  });

  it("ignores a late world summary from the previous topic", async () => {
    let finish!: (value: { summary: string; question: string }) => void;
    vi.mocked(api.worldSummary).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<Workshop />);
    await screen.findByText("Собираю сводку мира…");
    await userEvent.click(screen.getByRole("button", { name: "Новая тема" }));
    await screen.findByRole("separator", { name: "Новая тема" });
    await act(async () => { finish({ summary: "Запоздавшая старая сводка", question: "Старый вопрос?" }); });
    expect(screen.queryByText("Запоздавшая старая сводка")).not.toBeInTheDocument();
    expect(screen.queryByText("Мир кампании")).not.toBeInTheDocument();
  });

  it("disables topic changes during generation and while saving the boundary", async () => {
    vi.mocked(api.brainstormStatus).mockResolvedValue({ running: true, partial: "", error: null });
    const view = render(<Workshop />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Новая тема" })).toBeDisabled());
    view.unmount();
    vi.mocked(api.brainstormStatus).mockResolvedValue({ running: false, partial: "", error: null });
    let finish!: (value: ConversationMessage) => void;
    vi.mocked(api.startWorkshopTopic).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<Workshop />);
    await screen.findByText("Прежний ответ");
    await userEvent.click(screen.getByRole("button", { name: "Новая тема" }));
    expect(screen.getByRole("button", { name: "Новая тема" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Сообщение" })).toBeDisabled();
    expect(screen.queryByLabelText("ИИ печатает")).not.toBeInTheDocument();
    await act(async () => finish(marker));
    expect(screen.getByRole("button", { name: "Новая тема" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();
  });

  it("keeps the new boundary when a stopped generation returns old history late", async () => {
    let finish!: (value: ConversationMessage[]) => void;
    vi.mocked(api.getConversation).mockResolvedValueOnce(history).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.brainstormStatus).mockResolvedValueOnce({ running: true, partial: "", error: null }).mockResolvedValue({ running: false, partial: "", error: null });
    vi.mocked(api.stopBrainstorm).mockResolvedValue(undefined);
    render(<Workshop />);
    await waitFor(() => expect(api.getConversation).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: "Стоп" }));
    await userEvent.click(screen.getByRole("button", { name: "Новая тема" }));
    await screen.findByRole("separator", { name: "Новая тема" });
    await act(async () => { finish(history); });
    expect(screen.getByRole("separator", { name: "Новая тема" })).toBeInTheDocument();
    expect(screen.getByText(/напишите первый вопрос новой темы/i)).toBeInTheDocument();
  });

  it("keeps the current topic and summary if the server rejects the switch", async () => {
    vi.mocked(api.startWorkshopTopic).mockRejectedValueOnce(new Error("Дождитесь завершения генерации мастерской"));
    render(<Workshop />);
    await screen.findByText("Сводка прежней темы");
    await userEvent.click(screen.getByRole("button", { name: "Новая тема" }));
    expect(await screen.findByText("Дождитесь завершения генерации мастерской")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByText("Сводка прежней темы")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Новая тема" })).toBeEnabled();
  });
});
