import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";
import { WorkshopChatProvider } from "./WorkshopChatContext.js";
import { WorkshopPanel } from "./WorkshopPanel.js";

vi.mock("../../api/client.js");

const portrait = { id: "img-portrait", name: "portrait.png", mimeType: "image/png" as const };
const map = { id: "img-map", name: "map.png", mimeType: "image/png" as const };
const documents: Document[] = [
  { id: "baron", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x" },
  { id: "castle", campaignId: "c1", type: "location", title: "Замок", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x" },
];

function Workshop({ campaignId = "c1" }: { campaignId?: string }) {
  return <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ToastProvider>
    <WorkshopChatProvider campaignId={campaignId} onApproved={vi.fn()}><WorkshopPanel /></WorkshopChatProvider>
  </ToastProvider></MemoryRouter>;
}

function uploadedMessage() {
  vi.mocked(api.getConversation).mockResolvedValue([
    { id: "uploaded", role: "user", content: "Референсы", meta: { images: [portrait, map] }, createdAt: "x" },
  ]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getConversation).mockResolvedValue([{ id: "hello", role: "assistant", content: "Привет!", createdAt: "x" }]);
  vi.mocked(api.listProposals).mockResolvedValue([]);
  vi.mocked(api.brainstormStatus).mockResolvedValue({ running: false, partial: "", error: null });
  vi.mocked(api.worldSummary).mockResolvedValue({ summary: "", question: "" });
  vi.mocked(api.listCampaignDocuments).mockResolvedValue(documents);
});

describe("WorkshopPanel image attachments", () => {
  it("renders confirmed attachment previews and per-target failures from reloaded message metadata", async () => {
    const history = [{
      id: "result", role: "assistant" as const, content: "Обработал иллюстрации.", createdAt: "x",
      meta: { imageAttachments: [
        { documentId: "baron", documentTitle: "Барон", image: portrait },
        { documentId: "castle", documentTitle: "Замок", error: "Файл изображения не найден" },
      ] },
    }];
    vi.mocked(api.getConversation).mockResolvedValue(history);
    const view = render(<Workshop />);

    const results = await screen.findByRole("list", { name: "Результаты прикрепления изображений" });
    const rows = within(results).getAllByRole("listitem");
    expect(within(rows[0]).getByAltText("portrait.png")).toHaveAttribute("src", "/api/images/img-portrait");
    expect(within(rows[0]).getByRole("link", { name: "Барон" })).toHaveAttribute("href", "/campaigns/c1/documents/baron");
    expect(within(rows[0]).getByText("Прикреплено")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "Замок" })).toHaveAttribute("href", "/campaigns/c1/documents/castle");
    expect(within(rows[1]).getByText("Файл изображения не найден")).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("img")).not.toBeInTheDocument();

    view.unmount();
    render(<Workshop />);
    expect(await screen.findByText("Прикреплено")).toBeInTheDocument();
  });

  it("does not present assistant completion prose as a confirmed attachment", async () => {
    vi.mocked(api.getConversation).mockResolvedValue([
      { id: "claim", role: "assistant", content: "Готово, все портреты прикреплены к сущностям!", createdAt: "x" },
    ]);
    render(<Workshop />);
    await screen.findByText("Готово, все портреты прикреплены к сущностям!");
    expect(screen.queryByText("Прикреплено")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Результаты прикрепления изображений" })).not.toBeInTheDocument();
  });

  it("shows more than four generated results without placing them in the image composer", async () => {
    const history = [{
      id: "many", role: "assistant" as const, content: "Пять портретов.", createdAt: "x",
      meta: { imageAttachments: Array.from({ length: 5 }, (_, index) => ({
        documentId: `npc-${index}`, documentTitle: `Персонаж ${index + 1}`, image: { ...portrait, id: `portrait-${index}` },
      })) },
    }];
    vi.mocked(api.getConversation).mockResolvedValue(history);
    render(<Workshop />);
    const results = await screen.findByRole("list", { name: "Результаты прикрепления изображений" });
    expect(within(results).getAllByRole("img")).toHaveLength(5);
    expect(screen.queryByRole("list", { name: "Прикреплённые изображения" })).not.toBeInTheDocument();
  });

  it("attaches the chosen uploaded image to the explicitly selected entity and confirms the stored result", async () => {
    uploadedMessage();
    vi.mocked(api.attachDocumentImage).mockResolvedValue([map]);
    render(<Workshop />);
    await userEvent.click(await screen.findByRole("button", { name: "Прикрепить map.png к сущности" }));
    const dialog = await screen.findByRole("dialog", { name: "Прикрепить изображение" });
    const confirm = within(dialog).getByRole("button", { name: "Прикрепить" });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(await within(dialog).findByLabelText("Сущность"), "castle");
    await userEvent.click(confirm);

    await waitFor(() => expect(api.attachDocumentImage).toHaveBeenCalledWith("castle", "img-map"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Прикреплено")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Замок" })).toHaveAttribute("href", "/campaigns/c1/documents/castle");
    expect(api.updateDocument).not.toHaveBeenCalled();
  });

  it("keeps an attachment failure visible in the picker without claiming success", async () => {
    uploadedMessage();
    vi.mocked(api.attachDocumentImage).mockRejectedValue(new Error("Не удалось сохранить изображение"));
    render(<Workshop />);
    await userEvent.click(await screen.findByRole("button", { name: "Прикрепить portrait.png к сущности" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(await within(dialog).findByLabelText("Сущность"), "baron");
    await userEvent.click(within(dialog).getByRole("button", { name: "Прикрепить" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Не удалось сохранить изображение");
    expect(within(dialog).getByLabelText("Сущность")).toHaveValue("baron");
    expect(within(dialog).getByRole("button", { name: "Прикрепить" })).toBeEnabled();
    expect(screen.queryByText("Прикреплено")).not.toBeInTheDocument();
  });

  it("locks the selected target while attaching and ignores completion after changing campaigns", async () => {
    uploadedMessage();
    let finish!: (images: typeof portrait[]) => void;
    vi.mocked(api.attachDocumentImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<Workshop />);
    await userEvent.click(await screen.findByRole("button", { name: "Прикрепить portrait.png к сущности" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(await within(dialog).findByLabelText("Сущность"), "baron");
    await userEvent.click(within(dialog).getByRole("button", { name: "Прикрепить" }));
    expect(within(dialog).getByLabelText("Сущность")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Прикрепляю…" })).toBeDisabled();

    view.rerender(<Workshop campaignId="c2" />);
    await act(async () => finish([portrait]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Прикреплено")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Сообщение" })).toBeEnabled();
  });
});
