import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageMeta, Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";
import { DocumentAssistant } from "./DocumentAssistant.js";
import { GameChat, useGameChat } from "../play/GameChat.js";

vi.mock("../../api/client.js");
const image = { id: "image-one", name: "Дом — иллюстрация.png", mimeType: "image/png" as const };
const target: Document = { id: "d1", campaignId: "c1", title: "Дом", type: "location", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x" };
const results = [
  { documentId: "d1", documentTitle: "Дом", image, isAvatar: true },
  { documentId: "d2", documentTitle: "Башня", error: "Codex не смог создать изображение" },
];
const reply = { id: "answer", role: "assistant" as const, content: "Обработал запрос.", createdAt: "x", meta: { imageAttachments: results } as MessageMeta };

function Game({ onImagesChange }: { onImagesChange: () => void }) {
  const chat = useGameChat("d1", undefined, onImagesChange);
  return <GameChat docId="d1" campaignId="c1" chat={chat} pcs={[]} npcs={[]} documents={[]} buildSystem={() => "system"} playerView={false} currentText="" appliedBlocks={[]} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={vi.fn()} onImagesChange={onImagesChange} />;
}
function Chat({ kind, onImagesChange = vi.fn(), docId = "d1" }: { kind: "document" | "game"; onImagesChange?: () => void; docId?: string }) {
  return <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ToastProvider>{kind === "document"
    ? <DocumentAssistant docId={docId} campaignId="c1" title="Дом" typeLabel="Локация" documents={[]} getText={() => "Несохранённый текст"} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={vi.fn()} onImagesChange={onImagesChange} />
    : <Game onImagesChange={onImagesChange} />}</ToastProvider></MemoryRouter>;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getDocumentConversation).mockResolvedValue([]);
  vi.mocked(api.assistantStatus).mockResolvedValue({ running: false, partial: "", error: null });
  vi.mocked(api.startAssistant).mockResolvedValue({ started: true });
  vi.mocked(api.listCampaignDocuments).mockResolvedValue([target]);
  vi.mocked(api.attachDocumentImage).mockResolvedValue([image]);
  vi.mocked(api.setDocumentAvatar).mockResolvedValue({ ...target, avatar: image, fields: { avatarImageId: image.id } });
});

describe.each(["document", "game"] as const)("%s assistant image actions", (kind) => {
  it("renders confirmed previews, avatar status and per-action errors after reopening", async () => {
    vi.mocked(api.getDocumentConversation).mockResolvedValue([reply]);
    render(<Chat kind={kind} />);
    const list = await screen.findByRole("list", { name: "Результаты прикрепления изображений" });
    expect(within(list).getByText("Главное изображение")).toBeInTheDocument();
    expect(within(list).getByText("Codex не смог создать изображение")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: `Открыть ${image.name}` }));
    expect(within(screen.getByRole("dialog", { name: "Просмотр изображения" })).getByRole("img")).toHaveAttribute("src", "/api/images/image-one");
  });

  it("does not show endless typing for a completed image-only result", async () => {
    vi.mocked(api.getDocumentConversation).mockResolvedValue([{ ...reply, content: "" }]);
    render(<Chat kind={kind} />);
    await screen.findByRole("list", { name: "Результаты прикрепления изображений" });
    expect(document.querySelector(".typing")).not.toBeInTheDocument();
  });

  it("can attach an uploaded message image to the current entity and select it as avatar", async () => {
    vi.mocked(api.getDocumentConversation).mockResolvedValue([{ id: "upload", role: "user", content: "Референс", createdAt: "x", meta: { images: [image] } }]);
    const changed = vi.fn();
    render(<Chat kind={kind} onImagesChange={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: `Прикрепить ${image.name} к сущности` }));
    const dialog = screen.getByRole("dialog", { name: "Прикрепить изображение" });
    await waitFor(() => expect(within(dialog).getByLabelText("Сущность")).toHaveValue("d1"));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Сделать главным изображением" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Прикрепить" }));
    await waitFor(() => expect(api.setDocumentAvatar).toHaveBeenCalledWith("d1", image.id));
    expect(api.attachDocumentImage).toHaveBeenCalledWith("d1", image.id);
    expect(changed).toHaveBeenCalledOnce();
    expect(await screen.findByText("Главное изображение")).toBeInTheDocument();
    expect(api.updateDocument).not.toHaveBeenCalled();
  });

  it("refreshes image metadata after background action completion", async () => {
    vi.mocked(api.getDocumentConversation).mockResolvedValueOnce([]).mockResolvedValue([reply]);
    const changed = vi.fn();
    render(<Chat kind={kind} onImagesChange={changed} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "Создай портрет");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(await screen.findByRole("list", { name: "Результаты прикрепления изображений" })).toBeInTheDocument();
  });

  it("retains the confirmed attachment if selecting its avatar fails", async () => {
    vi.mocked(api.getDocumentConversation).mockResolvedValue([{ id: "upload", role: "user", content: "", createdAt: "x", meta: { images: [image] } }]);
    vi.mocked(api.setDocumentAvatar).mockRejectedValue(new Error("Не удалось назначить аватар"));
    const changed = vi.fn();
    render(<Chat kind={kind} onImagesChange={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: `Прикрепить ${image.name} к сущности` }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Прикрепить" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Сделать главным изображением" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Прикрепить" }));
    const list = await screen.findByRole("list", { name: "Результаты прикрепления изображений" });
    expect(within(list).getByText("Прикреплено")).toBeInTheDocument();
    expect(within(list).getByText(/Не удалось назначить аватар/)).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: `Открыть ${image.name}` })).toBeInTheDocument();
    expect(within(list).queryByText("Главное изображение")).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce();
  });
});

it("hides image controls after a game log block while keeping the narrative", async () => {
  vi.mocked(api.getDocumentConversation).mockResolvedValue([{
    ...reply, meta: {}, content: 'Дверь открыта.\n```log\n{"title":"Вход","important":false}\n```\n```json\n{"imageAttachments":[{"documentId":"d1","prompt":"PRIVATE_VISUAL_PROMPT"}]}\n```',
  }]);
  render(<Chat kind="game" />);
  await screen.findByText("Дверь открыта.");
  expect(document.body).not.toHaveTextContent("imageAttachments");
  expect(document.body).not.toHaveTextContent("PRIVATE_VISUAL_PROMPT");
});

it("does not let a pending manual attachment change another document after navigation", async () => {
  vi.mocked(api.getDocumentConversation).mockResolvedValue([{ id: "upload", role: "user", content: "", createdAt: "x", meta: { images: [image] } }]);
  let finish!: (images: typeof image[]) => void;
  vi.mocked(api.attachDocumentImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const changed = vi.fn();
  const view = render(<Chat kind="document" onImagesChange={changed} />);
  await userEvent.click(await screen.findByRole("button", { name: `Прикрепить ${image.name} к сущности` }));
  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Прикрепить" })).toBeEnabled());
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Сделать главным изображением" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Прикрепить" }));
  view.rerender(<Chat kind="document" docId="d2" onImagesChange={changed} />);
  await act(async () => finish([image]));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.setDocumentAvatar).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
