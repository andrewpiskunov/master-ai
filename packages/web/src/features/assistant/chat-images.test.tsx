import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";
import { WorkshopChatProvider } from "./WorkshopChatContext.js";
import { WorkshopPanel } from "./WorkshopPanel.js";
import { DocumentAssistant } from "./DocumentAssistant.js";
import { GameChat, useGameChat } from "../play/GameChat.js";

vi.mock("../../api/client.js");
const image = { id: "img1", name: "map.png", mimeType: "image/png" as const };
function paste(target: HTMLElement, files = [new File(["map"], "map.png", { type: "image/png" })]) {
  return fireEvent.paste(target, { clipboardData: { items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })), files } });
}
function Game({ docId = "d1" }: { docId?: string }) {
  const chat = useGameChat(docId);
  return <GameChat docId={docId} campaignId="c1" chat={chat} pcs={[]} npcs={[]} documents={[]} buildSystem={() => "system"} playerView={false} currentText="" appliedBlocks={[]} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={vi.fn()} />;
}
function Chat({ kind, context = "1" }: { kind: "workshop" | "document" | "game"; context?: string }) {
  return <ToastProvider>{kind === "workshop"
    ? <WorkshopChatProvider campaignId={`c${context}`} onApproved={vi.fn()}><WorkshopPanel /></WorkshopChatProvider>
    : kind === "document"
      ? <DocumentAssistant campaignId="c1" docId={`d${context}`} title="Map" typeLabel="Локация" documents={[]} getText={() => ""} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={vi.fn()} />
      : <Game docId={`d${context}`} /> }</ToastProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getConversation).mockResolvedValue([{ id: "hello", role: "assistant", content: "Привет", createdAt: "x" }]);
  vi.mocked(api.getDocumentConversation).mockResolvedValue([]);
  vi.mocked(api.listProposals).mockResolvedValue([]);
  vi.mocked(api.brainstormStatus).mockResolvedValue({ running: false, partial: "", error: null });
  vi.mocked(api.assistantStatus).mockResolvedValue({ running: false, partial: "", error: null });
  vi.mocked(api.uploadImage).mockResolvedValue(image);
  vi.mocked(api.startAssistant).mockResolvedValue({ started: true });
  vi.mocked(api.startBrainstorm).mockResolvedValue({ started: true });
  vi.mocked(api.worldSummary).mockResolvedValue({ summary: "", question: "" });
});

describe.each(["workshop", "document", "game"] as const)("%s image composer", (kind) => {
  it("previews pasted images without sending, then sends an image-only message", async () => {
    render(<Chat kind={kind} />);
    const input = screen.getByRole("textbox");
    paste(input);
    expect(await screen.findByAltText("map.png")).toBeInTheDocument();
    expect(api.startAssistant).not.toHaveBeenCalled();
    expect(api.startBrainstorm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    if (kind === "workshop") await waitFor(() => expect(api.startBrainstorm).toHaveBeenCalledWith("c1", "", [image]));
    else await waitFor(() => expect(api.startAssistant).toHaveBeenCalledWith("d1", "", expect.any(String), expect.objectContaining({ images: [image] })));
    expect(api.uploadImage).toHaveBeenCalledWith("c1", { name: "map.png", dataUrl: "data:image/png;base64,bWFw" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Убрать map.png" })).not.toBeInTheDocument());
  });

  it("opens persisted message images in the app after loading history", async () => {
    const history = [{ id: "stored", role: "user" as const, content: "", meta: { images: [image] }, createdAt: "x" }];
    vi.mocked(api.getConversation).mockResolvedValue(history);
    vi.mocked(api.getDocumentConversation).mockResolvedValue(history);
    render(<Chat kind={kind} />);
    expect(await screen.findByAltText("map.png")).toHaveAttribute("src", "/api/images/img1/thumbnail?size=256");
    await userEvent.click(screen.getByRole("button", { name: "Открыть map.png" }));
    const dialog = screen.getByRole("dialog", { name: "Просмотр изображения" });
    expect(within(dialog).getByRole("img", { name: "map.png" })).toHaveAttribute("src", "/api/images/img1");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Открыть map.png" })).toHaveFocus();
  });

  it("preserves a failed upload without starting a request", async () => {
    vi.mocked(api.uploadImage).mockRejectedValue(new Error("Хранилище недоступно"));
    render(<Chat kind={kind} />);
    const input = screen.getByRole("textbox");
    paste(input);
    await screen.findByAltText("map.png");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Хранилище недоступно")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Убрать map.png" })).toBeInTheDocument();
    expect(api.startAssistant).not.toHaveBeenCalled();
    expect(api.startBrainstorm).not.toHaveBeenCalled();
  });

  it("discards pending uploads when switching context and unlocks the new composer", async () => {
    let finish!: (result: typeof image) => void;
    vi.mocked(api.uploadImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<Chat kind={kind} />);
    paste(screen.getByRole("textbox"));
    await screen.findByAltText("map.png");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    view.rerender(<Chat kind={kind} context="2" />);
    await act(async () => finish(image));
    expect(api.startAssistant).not.toHaveBeenCalled();
    expect(api.startBrainstorm).not.toHaveBeenCalled();
    expect(screen.queryByAltText("map.png")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("keeps text and image draft when the start fails, and displays the server reason", async () => {
    vi.mocked(api.startAssistant).mockRejectedValue(new Error("Текущий провайдер не поддерживает изображения"));
    vi.mocked(api.startBrainstorm).mockRejectedValue(new Error("Текущий провайдер не поддерживает изображения"));
    render(<Chat kind={kind} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Разбери карту");
    paste(input);
    await screen.findByAltText("map.png");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Текущий провайдер не поддерживает изображения")).toBeInTheDocument();
    expect(input).toHaveValue("Разбери карту");
    expect(screen.getByRole("button", { name: "Убрать map.png" })).toBeInTheDocument();
    expect(screen.getAllByAltText("map.png")).toHaveLength(1);
  });
});


describe.each(["workshop", "document"] as const)("%s stop upload", (kind) => {
  it("stops a pending upload from launching a later chat request", async () => {
    let finish!: (result: typeof image) => void;
    vi.mocked(api.uploadImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<Chat kind={kind} />);
    paste(screen.getByRole("textbox"));
    await screen.findByAltText("map.png");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await userEvent.click(screen.getByRole("button", { name: "Стоп" }));
    await act(async () => finish(image));
    expect(api.startAssistant).not.toHaveBeenCalled();
    expect(api.startBrainstorm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Убрать map.png" })).toBeEnabled();
  });
});
