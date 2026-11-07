import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import type { Document, ImageAttachment } from "@master-ai/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client.js";
import { PlayImages, type PlayerImageScreen } from "./PlayImages.js";

vi.mock("../../api/client.js");
const map: ImageAttachment = { id: "map", name: "Карта гавани", mimeType: "image/png" };
const portrait: ImageAttachment = { id: "portrait", name: "Проводник", mimeType: "image/webp" };
const document = (overrides: Partial<Document> = {}): Document => ({
  id: "session", campaignId: "c1", type: "session", title: "Сессия в гавани", status: null,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Скрытая заметка мастера" }] }] },
  fields: { secret: "секрет" }, createdAt: "2026-11-08", updatedAt: "2026-11-08", ...overrides,
});
const session = document();
const npc = document({ id: "npc", title: "Проводник", type: "npc" });
const location = document({ id: "location", title: "Гавань", type: "location" });
const show = vi.fn();
const clear = vi.fn();
function controller(overrides: Partial<PlayerImageScreen> = {}): PlayerImageScreen {
  return { image: null, captionVisible: false, error: "", show, clear, ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.documentImages).mockImplementation(async (id) => id === "npc" ? [portrait] : [map]);
});

describe("PlayImages", () => {
  it("открывает изображения текущей сессии, даже когда список сущностей ещё пуст", async () => {
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    expect(screen.getByLabelText("Изображения сущности")).toHaveValue("session");
    expect(await screen.findByRole("button", { name: "Открыть Карта гавани" })).toBeInTheDocument();
    expect(api.documentImages).toHaveBeenCalledWith("session");
    expect(screen.queryByText("Скрытая заметка мастера")).not.toBeInTheDocument();
  });

  it("выбирает все типы текущей кампании и начинает с открытого документа", async () => {
    const docs = [npc, location, document({ id: "secret", type: "secret", title: "Тайна" }), document({ id: "other", campaignId: "c2", title: "Другая кампания" })];
    render(<PlayImages campaignId="c1" documents={docs} session={session} initialDocumentId="npc" playerScreen={controller()} />);
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
    const selector = screen.getByLabelText("Изображения сущности");
    expect(selector).toHaveValue("npc");
    expect(within(selector).getAllByRole("option")).toHaveLength(4);
    expect(within(selector).queryByRole("option", { name: /другая кампания/i })).not.toBeInTheDocument();
    await userEvent.selectOptions(selector, "secret");
    expect(api.documentImages).toHaveBeenLastCalledWith("secret");
  });

  it("сохраняет ручной выбор при позднем обновлении списка сущностей", async () => {
    const view = render(<PlayImages campaignId="c1" documents={[npc]} session={session} playerScreen={controller()} />);
    await screen.findByRole("button", { name: "Открыть Карта гавани" });
    await userEvent.selectOptions(screen.getByLabelText("Изображения сущности"), "npc");
    view.rerender(<PlayImages campaignId="c1" documents={[npc, location]} session={session} initialDocumentId="location" playerScreen={controller()} />);
    expect(screen.getByLabelText("Изображения сущности")).toHaveValue("npc");
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
  });

  it("не показывает запоздавший ответ предыдущей сущности", async () => {
    const old = deferred<ImageAttachment[]>();
    vi.mocked(api.documentImages).mockImplementation((id) => id === "session" ? old.promise : Promise.resolve([portrait]));
    render(<PlayImages campaignId="c1" documents={[npc]} session={session} playerScreen={controller()} />);
    await userEvent.selectOptions(screen.getByLabelText("Изображения сущности"), "npc");
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
    await act(async () => old.resolve([map]));
    expect(screen.queryByRole("button", { name: "Открыть Карта гавани" })).not.toBeInTheDocument();
  });

  it("открывает изображение в общем просмотрщике", async () => {
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Открыть Карта гавани" }));
    expect(screen.getByRole("dialog", { name: "Просмотр изображения" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("отправляет только изображение и выключенную по умолчанию подпись", async () => {
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    expect(screen.getByRole("checkbox", { name: "Показывать название изображения игрокам" })).not.toBeChecked();
    await userEvent.click(await screen.findByRole("button", { name: "Показать игрокам Карта гавани" }));
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(map, false);
  });

  it("включает подпись по явному выбору мастера и позволяет скрыть показ", async () => {
    function Harness() {
      const [image, setImage] = useState<ImageAttachment | null>(null);
      const [captionVisible, setCaption] = useState(false);
      return <PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller({ image, captionVisible,
        show: (next, caption = false) => { show(next, caption); setImage(next); setCaption(caption); },
        clear: () => { clear(); setImage(null); setCaption(false); },
      })} />;
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Показывать название изображения игрокам" }));
    await userEvent.click(await screen.findByRole("button", { name: "Показать игрокам Карта гавани" }));
    expect(show).toHaveBeenLastCalledWith(map, true);
    expect(screen.getByText("На экране игроков")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Скрыть изображение" }));
    expect(clear).toHaveBeenCalledOnce();
    expect(screen.queryByText("На экране игроков")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("повторяет загрузку галереи после ошибки и показывает ошибки экрана игроков", async () => {
    vi.mocked(api.documentImages).mockRejectedValueOnce(new Error("Галерея недоступна")).mockResolvedValueOnce([map]);
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller({ error: "Разрешите открытие окна игроков" })} />);
    expect(await screen.findByText("Галерея недоступна")).toBeInTheDocument();
    expect(screen.getByText("Разрешите открытие окна игроков")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить загрузку изображений" }));
    expect(await screen.findByRole("button", { name: "Открыть Карта гавани" })).toBeInTheDocument();
  });

  it("показывает понятное пустое состояние", async () => {
    vi.mocked(api.documentImages).mockResolvedValue([]);
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    expect(await screen.findByText("У этой сущности пока нет изображений")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /показать игрокам/i })).not.toBeInTheDocument();
  });

  it("изолирует ответы предыдущей кампании при смене маршрута", async () => {
    const old = deferred<ImageAttachment[]>();
    vi.mocked(api.documentImages).mockImplementation((id) => id === "session" ? old.promise : Promise.resolve([portrait]));
    const view = render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    view.rerender(<PlayImages campaignId="c2" documents={[]} session={document({ id: "session2", campaignId: "c2" })} playerScreen={controller()} />);
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
    await act(async () => old.resolve([map]));
    expect(screen.queryByRole("button", { name: "Открыть Карта гавани" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Изображения сущности")).toHaveValue("session2");
  });
  it("не обещает успешный показ, если окно игроков не открылось", async () => {
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller({ image: map, error: "Окно заблокировано" })} />);
    expect(screen.getByText("Выбрано для показа")).toBeInTheDocument();
    expect(screen.queryByText("На экране игроков")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Показать игрокам Карта гавани" })).toHaveTextContent("Показать игрокам");
  });

  it("отражает ранее включённую подпись и сразу отключает её у текущего изображения", async () => {
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller({ image: map, captionVisible: true })} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(show).toHaveBeenCalledWith(map, false);
  });

});
