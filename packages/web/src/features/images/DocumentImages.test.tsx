import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api/client.js";
import { DocumentImages } from "./DocumentImages.js";
import type { Document } from "@master-ai/shared";

vi.mock("../../api/client.js");
const image = { id: "img1", name: "portrait.png", mimeType: "image/png" as const };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.documentImages).mockResolvedValue([]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
});
afterEach(() => vi.useRealTimers());
function Panel({ docId = "d1" }: { docId?: string }) {
  return <DocumentImages campaignId="c1" docId={docId} title="Барон" typeLabel="Персонаж" description="Высокий ворон" />;
}
describe("DocumentImages", () => {
  it("ignores a late avatar selection response for an image deleted through its viewer", async () => {
    const removed = { ...image, id: "avatar-race-delete", name: "Поздний.png" };
    const kept = { ...image, id: "avatar-race-keep", name: "Другой.png" };
    vi.mocked(api.documentImages).mockResolvedValue([kept, removed]);
    vi.mocked(api.deleteImage).mockResolvedValue({ deleted: true });
    let finish!: (doc: Document) => void;
    vi.mocked(api.setDocumentAvatar).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onDocumentChange = vi.fn();
    render(<DocumentImages campaignId="c1" docId="d1" title="Барон" typeLabel="NPC" description="Описание" avatar={kept} onDocumentChange={onDocumentChange} />);
    await userEvent.click(await screen.findByRole("button", { name: "Сделать аватаром Поздний.png" }));
    await userEvent.click(screen.getByRole("button", { name: "Открыть Поздний.png" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Просмотр изображения" })).getByRole("button", { name: "Удалить Поздний.png" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Удалить изображение" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await act(async () => { finish({ id: "d1", campaignId: "c1", title: "Барон", type: "npc", status: null, contentJson: null, fields: { avatarImageId: removed.id }, avatar: removed, createdAt: "x", updatedAt: "x" }); });
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Аватар: Другой.png" })).toBeInTheDocument();
  });

  it("permanently deletes from the gallery while preserving the prompt and remaining images", async () => {
    const removed = { ...image, id: "gallery-delete", name: "Удаляемый.png" };
    const kept = { ...image, id: "gallery-keep", name: "Оставляемый.png" };
    vi.mocked(api.documentImages).mockResolvedValue([removed, kept]);
    vi.mocked(api.deleteImage).mockResolvedValue({ deleted: true });
    render(<Panel />);
    await userEvent.type(screen.getByLabelText("Описание иллюстрации"), " Черновик");
    await userEvent.click(await screen.findByRole("button", { name: "Удалить Удаляемый.png" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Удалить изображение" }));
    await waitFor(() => expect(screen.queryByAltText("Удаляемый.png")).not.toBeInTheDocument());
    expect(api.deleteImage).toHaveBeenCalledWith("gallery-delete");
    expect(api.detachDocumentImage).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Аватар: Оставляемый.png" })).toBeInTheDocument();
    expect((screen.getByLabelText("Описание иллюстрации") as HTMLTextAreaElement).value).toContain("Черновик");
  });

  it("uploads a chosen file, attaches it to the entity, and detaches only its association", async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(image);
    vi.mocked(api.attachDocumentImage).mockResolvedValue([image]);
    vi.mocked(api.detachDocumentImage).mockResolvedValue([]);
    render(<Panel />);
    await userEvent.upload(screen.getByLabelText("Выбрать изображения"), new File(["png"], "portrait.png", { type: "image/png" }));
    await screen.findByRole("button", { name: "Убрать portrait.png" });
    await userEvent.click(screen.getByRole("button", { name: "Прикрепить к сущности" }));
    await waitFor(() => expect(api.attachDocumentImage).toHaveBeenCalledWith("d1", "img1"));
    await userEvent.click(await screen.findByRole("button", { name: "Открыть portrait.png" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Открепить portrait.png" }));
    await waitFor(() => expect(screen.queryByAltText("portrait.png")).not.toBeInTheDocument());
    expect(api.detachDocumentImage).toHaveBeenCalledWith("d1", "img1");
    expect(api.updateDocument).not.toHaveBeenCalled();
  });

  it("pastes into the focused target without submitting, and renders invalid image feedback", async () => {
    render(<Panel />);
    const target = screen.getByRole("textbox", { name: "Вставка изображений" });
    const file = new File(["gif"], "bad.gif", { type: "image/gif" });
    fireEvent.paste(target, { clipboardData: { files: [file], items: [] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PNG, JPEG и WebP/);
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it("generates using the edited prompt, then refreshes the gallery", async () => {
    vi.mocked(api.startImageGeneration).mockResolvedValue({ started: true });
    vi.mocked(api.imageGenerationStatus)
      .mockResolvedValueOnce({ running: false, error: null })
      .mockResolvedValue({ running: false, error: null, image });
    vi.mocked(api.documentImages).mockResolvedValueOnce([]).mockResolvedValue([image]);
    render(<Panel />);
    const prompt = screen.getByLabelText("Описание иллюстрации");
    await userEvent.clear(prompt);
    await userEvent.type(prompt, "Барон на фоне башни");
    await userEvent.click(screen.getByRole("button", { name: "Создать иллюстрацию" }));
    expect(api.startImageGeneration).toHaveBeenCalledWith("d1", "Барон на фоне башни");
    expect(await screen.findByRole("button", { name: "Открыть portrait.png" })).toBeInTheDocument();
    expect(screen.getByText("Иллюстрация прикреплена")).toBeInTheDocument();
  });

  it("resumes a running job on opening and lets the user stop it", async () => {
    vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: true, error: null });
    vi.mocked(api.stopImageGeneration).mockResolvedValue(undefined);
    render(<Panel />);
    await userEvent.click(await screen.findByRole("button", { name: "Остановить иллюстрацию" }));
    expect(api.stopImageGeneration).toHaveBeenCalledWith("d1");
    expect(await screen.findByText("Генерация остановлена")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать иллюстрацию" })).toBeEnabled();
  });

  it("shows generation failure details and keeps the prompt for retry", async () => {
    vi.mocked(api.startImageGeneration).mockRejectedValue(new Error("Создание иллюстраций доступно только через Codex"));
    render(<Panel />);
    await userEvent.click(screen.getByRole("button", { name: "Создать иллюстрацию" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Создание иллюстраций доступно только через Codex");
    expect((screen.getByLabelText("Описание иллюстрации") as HTMLTextAreaElement).value).toContain("Барон");
  });

  it("discards late gallery/status responses after switching documents", async () => {
    let finish!: (images: typeof image[]) => void;
    vi.mocked(api.documentImages).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue([]);
    const view = render(<Panel />);
    view.rerender(<Panel docId="d2" />);
    finish([image]);
    await waitFor(() => expect(api.documentImages).toHaveBeenCalledWith("d2"));
    expect(screen.queryByAltText("portrait.png")).not.toBeInTheDocument();
  });

  it("keeps Stop and retries after a transient polling failure, then shows the finished image", async () => {
    vi.useFakeTimers();
    vi.mocked(api.imageGenerationStatus)
      .mockResolvedValueOnce({ running: true, error: null })
      .mockRejectedValueOnce(new Error("Сервер временно недоступен"))
      .mockResolvedValue({ running: false, error: null, image });
    vi.mocked(api.documentImages).mockResolvedValueOnce([]).mockResolvedValue([image]);
    render(<Panel />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Остановить иллюстрацию" })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByRole("alert")).toHaveTextContent("Сервер временно недоступен");
    expect(screen.getByRole("button", { name: "Остановить иллюстрацию" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Создать иллюстрацию" })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByRole("button", { name: "Открыть portrait.png" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Иллюстрация прикреплена")).toBeInTheDocument();
  });

  it("blocks duplicate starts when the initial status is unknown and retries until it can resume", async () => {
    vi.useFakeTimers();
    vi.mocked(api.imageGenerationStatus)
      .mockRejectedValueOnce(new Error("Нет связи с сервером"))
      .mockResolvedValue({ running: true, error: null });
    render(<Panel />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Создать иллюстрацию" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Нет связи с сервером");
    fireEvent.click(screen.getByRole("button", { name: "Создать иллюстрацию" }));
    expect(api.startImageGeneration).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByRole("button", { name: "Остановить иллюстрацию" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resumes an existing job after a start conflict instead of unlocking another start", async () => {
    vi.useFakeTimers();
    const conflict = new ApiError(409, "Генерация уже идёт");
    conflict.status = 409;
    vi.mocked(api.startImageGeneration).mockRejectedValue(conflict);
    vi.mocked(api.imageGenerationStatus)
      .mockResolvedValueOnce({ running: false, error: null })
      .mockResolvedValueOnce({ running: true, error: null })
      .mockResolvedValue({ running: false, error: null, image });
    vi.mocked(api.documentImages).mockResolvedValueOnce([]).mockResolvedValue([image]);
    render(<Panel />);
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Создать иллюстрацию" })); });
    expect(screen.getByRole("button", { name: "Остановить иллюстрацию" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Создать иллюстрацию" })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(screen.getByRole("button", { name: "Открыть portrait.png" })).toBeInTheDocument();
    expect(api.startImageGeneration).toHaveBeenCalledTimes(1);
  });

  it("cancels a scheduled retry when the panel unmounts", async () => {
    vi.useFakeTimers();
    vi.mocked(api.imageGenerationStatus).mockRejectedValue(new Error("Нет связи"));
    const view = render(<Panel />);
    await act(async () => {});
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2400); });
    expect(api.imageGenerationStatus).toHaveBeenCalledTimes(1);
  });

});

const alternateImage = { id: "img2", name: "tower.png", mimeType: "image/png" as const };
const selectedDocument: Document = {
  id: "d1", campaignId: "c1", type: "location", title: "Башня", status: null,
  contentJson: null, fields: { tags: ["сохранено"], avatarImageId: "img2" },
  avatar: alternateImage, createdAt: "x", updatedAt: "y",
};

it("selects a gallery avatar, identifies it, and resets to the first image", async () => {
  vi.mocked(api.documentImages).mockResolvedValue([image, alternateImage]);
  vi.mocked(api.setDocumentAvatar).mockResolvedValueOnce(selectedDocument)
    .mockResolvedValueOnce({ ...selectedDocument, avatar: image, fields: { tags: ["сохранено"] } });
  render(<DocumentImages campaignId="c1" docId="d1" title="Башня" typeLabel="Локация" description="" avatar={image} />);
  expect(await screen.findByRole("button", { name: "Аватар: portrait.png" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Сделать аватаром tower.png" }));
  expect(await screen.findByRole("button", { name: "Аватар: tower.png" })).toHaveAttribute("aria-pressed", "true");
  expect(api.setDocumentAvatar).toHaveBeenCalledWith("d1", "img2");
  await userEvent.click(screen.getByRole("button", { name: "Использовать первое изображение" }));
  expect(await screen.findByRole("button", { name: "Аватар: portrait.png" })).toHaveAttribute("aria-pressed", "true");
  expect(api.setDocumentAvatar).toHaveBeenLastCalledWith("d1", null);
  expect(api.updateDocument).not.toHaveBeenCalled();
});

it("keeps the current avatar after a failed selection and reports the error", async () => {
  vi.mocked(api.documentImages).mockResolvedValue([image, alternateImage]);
  vi.mocked(api.setDocumentAvatar).mockRejectedValue(new Error("Не удалось выбрать изображение"));
  render(<DocumentImages campaignId="c1" docId="d1" title="Башня" typeLabel="Локация" description="" avatar={image} />);
  await userEvent.click(await screen.findByRole("button", { name: "Сделать аватаром tower.png" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось выбрать изображение");
  expect(screen.getByRole("button", { name: "Аватар: portrait.png" })).toHaveAttribute("aria-pressed", "true");
});

it("discards a late avatar selection after navigating to another document", async () => {
  let finish!: (doc: Document) => void;
  vi.mocked(api.documentImages).mockResolvedValue([image, alternateImage]);
  vi.mocked(api.setDocumentAvatar).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const onDocumentChange = vi.fn();
  const view = render(<DocumentImages campaignId="c1" docId="d1" title="Башня" typeLabel="Локация" description="" avatar={image} onDocumentChange={onDocumentChange} />);
  await userEvent.click(await screen.findByRole("button", { name: "Сделать аватаром tower.png" }));
  view.rerender(<DocumentImages campaignId="c1" docId="d2" title="Замок" typeLabel="Локация" description="" avatar={image} onDocumentChange={onDocumentChange} />);
  await act(async () => { finish(selectedDocument); });
  expect(await screen.findByRole("button", { name: "Аватар: portrait.png" })).toHaveAttribute("aria-pressed", "true");
  expect(onDocumentChange).not.toHaveBeenCalled();
});
