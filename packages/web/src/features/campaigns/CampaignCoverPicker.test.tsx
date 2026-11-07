import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Campaign, ImageAttachment } from "@master-ai/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client.js";
import { CampaignCoverPicker } from "./CampaignCoverPicker.js";

vi.mock("../../api/client.js");
const map: ImageAttachment = { id: "map", name: "Карта.png", mimeType: "image/png" };
const portrait: ImageAttachment = { id: "portrait", name: "Портрет.webp", mimeType: "image/webp" };
const campaign: Campaign & { cover: ImageAttachment } = { id: "c1", name: "Гавань", system: null, description: null, realism: "balanced", llmProvider: "cli", llmSettings: {}, createdAt: "2026-11-05T00:00:00.000Z", cover: map };
const onChange = vi.fn();
const onClose = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.campaignImages).mockResolvedValue([map, portrait]);
  vi.mocked(api.setCampaignCover).mockImplementation(async (_id, imageId) => ({ ...campaign, cover: imageId === portrait.id ? portrait : imageId ? map : null }));
});
function openPicker() { return render(<CampaignCoverPicker campaign={campaign} onChange={onChange} onClose={onClose} />); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("CampaignCoverPicker", () => {
  it("выбирает изображение кампании и сохраняет его обложкой", async () => {
    openPicker();
    await userEvent.click(await screen.findByRole("button", { name: "Выбрать Портрет.webp" }));
    expect(screen.getByRole("button", { name: "Выбрано: Портрет.webp" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cover: portrait })));
    expect(api.setCampaignCover).toHaveBeenCalledWith("c1", "portrait");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("удаляет явную обложку без выбора первого изображения", async () => {
    openPicker();
    await userEvent.click(screen.getByRole("button", { name: "Убрать обложку" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cover: null })));
    expect(api.setCampaignCover).toHaveBeenCalledWith("c1", null);
  });

  it("загружает новый файл и делает его обложкой", async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(portrait);
    openPicker();
    await userEvent.upload(screen.getByLabelText("Загрузить обложку"), new File(["pixels"], "Портрет.webp", { type: "image/webp" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить обложку" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cover: portrait })));
    expect(api.uploadImage).toHaveBeenCalledWith("c1", { name: "Портрет.webp", dataUrl: "data:image/webp;base64,cGl4ZWxz" });
    expect(api.setCampaignCover).toHaveBeenCalledWith("c1", "portrait");
  });

  it("сохраняет выбор при ошибке и повторяет без повторной загрузки файла", async () => {
    vi.mocked(api.uploadImage).mockResolvedValue(portrait);
    vi.mocked(api.setCampaignCover).mockRejectedValueOnce(new Error("Не удалось сохранить обложку")).mockResolvedValueOnce({ ...campaign, cover: portrait });
    openPicker();
    await userEvent.upload(screen.getByLabelText("Загрузить обложку"), new File(["pixels"], "Портрет.webp", { type: "image/webp" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить обложку" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить обложку");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cover: portrait })));
    expect(api.uploadImage).toHaveBeenCalledTimes(1);
  });

  it("сообщает об ошибке загрузки файла и оставляет возможность повторить", async () => {
    vi.mocked(api.uploadImage).mockRejectedValueOnce(new Error("Ошибка загрузки")).mockResolvedValueOnce(portrait);
    openPicker();
    await userEvent.upload(screen.getByLabelText("Загрузить обложку"), new File(["pixels"], "Портрет.webp", { type: "image/webp" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сохранить обложку" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ошибка загрузки");
    expect(api.setCampaignCover).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("позволяет повторить загрузку галереи после ошибки", async () => {
    vi.mocked(api.campaignImages).mockRejectedValueOnce(new Error("Галерея недоступна")).mockResolvedValueOnce([portrait]);
    openPicker();
    expect(await screen.findByRole("alert")).toHaveTextContent("Галерея недоступна");
    await userEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    expect(await screen.findByRole("button", { name: "Выбрать Портрет.webp" })).toBeInTheDocument();
  });

  it("блокирует повторное сохранение и закрытие на время запроса", async () => {
    const saving = deferred<Campaign>();
    vi.mocked(api.setCampaignCover).mockReturnValue(saving.promise);
    openPicker();
    await userEvent.click(await screen.findByRole("button", { name: "Выбрать Портрет.webp" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    expect(screen.getByRole("button", { name: "Сохраняю…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Закрыть выбор обложки" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => saving.resolve({ ...campaign, cover: portrait }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("игнорирует ответ сохранения закрытой или сменившейся кампании", async () => {
    const saving = deferred<Campaign>();
    vi.mocked(api.setCampaignCover).mockReturnValue(saving.promise);
    const view = openPicker();
    await userEvent.click(await screen.findByRole("button", { name: "Выбрать Портрет.webp" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить обложку" }));
    view.rerender(<CampaignCoverPicker campaign={{ ...campaign, id: "c2", name: "Лес" }} onChange={onChange} onClose={onClose} />);
    await act(async () => saving.resolve({ ...campaign, cover: portrait }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
