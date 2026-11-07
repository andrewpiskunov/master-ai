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
const pickerButton = (title: string) => screen.getByRole("button", { name: `Выбрать сущность: ${title}` });
async function chooseEntity(title: string, currentTitle: string, showAll = true) {
  await userEvent.click(pickerButton(currentTitle));
  const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
  if (showAll) await userEvent.click(within(picker).getByRole("button", { name: /Все сущности/ }));
  await userEvent.click(within(picker).getByRole("button", { name: `Открыть галерею ${title}` }));
}
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
  it("сразу открывает первую сущность с изображениями и показывает только полезные галереи", async () => {
    render(<PlayImages campaignId="c1" documents={[npc, { ...location, avatar: map }]} session={session} playerScreen={controller()} />);
    expect(pickerButton("Гавань")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Открыть Карта гавани" })).toBeInTheDocument();
    await userEvent.click(pickerButton("Гавань"));
    const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
    expect(within(picker).getByRole("button", { name: /С изображениями/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(picker).getAllByRole("button", { name: /^Открыть галерею/ })).toHaveLength(1);
    expect(within(picker).getByRole("button", { name: "Открыть галерею Гавань" })).toHaveAttribute("aria-pressed", "true");
    expect(within(picker).getByAltText("Гавань")).toHaveAttribute("src", "/api/images/map");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("сохраняет явно открытый документ без картинок вместо автоматического выбора", async () => {
    vi.mocked(api.documentImages).mockImplementation(async (id) => id === "npc" ? [] : [map]);
    render(<PlayImages campaignId="c1" documents={[npc, { ...location, avatar: map }]} session={session} initialDocumentId="npc" playerScreen={controller()} />);
    expect(pickerButton("Проводник")).toBeInTheDocument();
    expect(await screen.findByText("У этой сущности пока нет изображений")).toBeInTheDocument();
  });

  it("выбирает полезную галерею после поздней загрузки списка сущностей", async () => {
    vi.mocked(api.documentImages).mockImplementation(async (id) => id === "session" ? [] : [portrait]);
    const view = render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    await screen.findByText("У этой сущности пока нет изображений");
    view.rerender(<PlayImages campaignId="c1" documents={[{ ...npc, avatar: portrait }]} session={session} playerScreen={controller()} />);
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
    expect(pickerButton("Проводник")).toBeInTheDocument();
  });

  it("сохраняет явный выбор пустой сессии после появления новых галерей", async () => {
    vi.mocked(api.documentImages).mockImplementation(async (id) => id === "session" ? [] : [portrait]);
    const view = render(<PlayImages campaignId="c1" documents={[{ ...npc, avatar: portrait }]} session={session} playerScreen={controller()} />);
    await screen.findByRole("button", { name: "Открыть Проводник" });
    await chooseEntity("Сессия в гавани", "Проводник");
    await screen.findByText("У этой сущности пока нет изображений");
    view.rerender(<PlayImages campaignId="c1" documents={[{ ...npc, avatar: portrait }, { ...location, avatar: map }]} session={session} playerScreen={controller()} refreshKey={1} />);
    expect(await screen.findByText("У этой сущности пока нет изображений")).toBeInTheDocument();
    expect(pickerButton("Сессия в гавани")).toBeInTheDocument();
  });

  it("ищет по названию и типу без учёта регистра и крайних пробелов, затем фильтрует по типу", async () => {
    const docs = [
      { ...npc, avatar: portrait }, { ...location, avatar: map },
      document({ id: "npc2", type: "npc", title: "Капитан гавани", avatar: portrait }),
      ...Array.from({ length: 35 }, (_, index) => document({ id: `item${index}`, type: "item", title: `Предмет ${index}`, avatar: map })),
    ];
    render(<PlayImages campaignId="c1" documents={docs} session={session} playerScreen={controller()} />);
    await userEvent.click(pickerButton("Гавань"));
    const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
    const search = within(picker).getByRole("searchbox", { name: "Поиск сущности" });
    expect(search).toHaveFocus();
    await userEvent.type(search, "  ГАВАН  ");
    expect(within(picker).getAllByRole("button", { name: /^Открыть галерею/ })).toHaveLength(2);
    await userEvent.click(within(picker).getByRole("button", { name: "Локация" }));
    expect(within(picker).getAllByRole("button", { name: /^Открыть галерею/ })).toHaveLength(1);
    await userEvent.click(within(picker).getByRole("button", { name: "Все типы" }));
    await userEvent.clear(search);
    await userEvent.type(search, " npc ");
    expect(within(picker).getAllByRole("button", { name: /^Открыть галерею/ })).toHaveLength(2);
    await userEvent.click(within(picker).getByRole("button", { name: "Открыть галерею Проводник" }));
    expect(pickerButton("Проводник")).toHaveFocus();
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
  });

  it("объясняет отсутствие изображений и позволяет явно открыть все сущности", async () => {
    vi.mocked(api.documentImages).mockResolvedValue([]);
    render(<PlayImages campaignId="c1" documents={[npc]} session={session} playerScreen={controller()} />);
    await userEvent.click(pickerButton("Сессия в гавани"));
    const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
    expect(within(picker).getByText("Пока нет сущностей с изображениями")).toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("button", { name: /Все сущности/ }));
    expect(within(picker).getByRole("button", { name: "Открыть галерею Проводник" })).toBeInTheDocument();
  });

  it("сбрасывает поиск и фильтры из пустой выдачи", async () => {
    render(<PlayImages campaignId="c1" documents={[{ ...npc, avatar: portrait }]} session={session} playerScreen={controller()} />);
    await userEvent.click(pickerButton("Проводник"));
    const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
    await userEvent.type(within(picker).getByRole("searchbox"), "Неизвестный");
    expect(within(picker).getByText("Ничего не найдено")).toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("button", { name: "Сбросить поиск и фильтры" }));
    expect(within(picker).getByRole("searchbox")).toHaveValue("");
    expect(within(picker).getByRole("button", { name: "Открыть галерею Проводник" })).toBeInTheDocument();
  });

  it("удерживает фокус в выборе, закрывается по Esc и возвращает фокус на карточку", async () => {
    render(<PlayImages campaignId="c1" documents={[{ ...npc, avatar: portrait }]} session={session} playerScreen={controller()} />);
    const trigger = pickerButton("Проводник");
    await userEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
    const controls = within(picker).getAllByRole("button");
    controls.at(-1)!.focus();
    await userEvent.tab();
    expect(picker.contains(window.document.activeElement)).toBe(true);
    await userEvent.tab({ shift: true });
    expect(controls.at(-1)).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("обновляет выбранную галерею по refreshKey и отбрасывает ответ старой загрузки", async () => {
    const old = deferred<ImageAttachment[]>();
    vi.mocked(api.documentImages).mockResolvedValueOnce([map]).mockReturnValueOnce(old.promise).mockResolvedValueOnce([portrait]);
    const playerScreen = controller({ image: map, captionVisible: true });
    const view = render(<PlayImages campaignId="c1" documents={[location]} session={session} playerScreen={playerScreen} />);
    await screen.findByRole("button", { name: "Открыть Карта гавани" });
    await chooseEntity("Гавань", "Сессия в гавани");
    view.rerender(<PlayImages campaignId="c1" documents={[location]} session={session} playerScreen={playerScreen} refreshKey={1} />);
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
    await act(async () => old.resolve([map]));
    expect(screen.queryByRole("button", { name: "Открыть Карта гавани" })).not.toBeInTheDocument();
    expect(pickerButton("Гавань")).toBeInTheDocument();
    expect(screen.getByText("На экране игроков")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(clear).not.toHaveBeenCalled();
  });

  it("открывает изображения текущей сессии, даже когда список сущностей ещё пуст", async () => {
    render(<PlayImages campaignId="c1" documents={[]} session={session} playerScreen={controller()} />);
    expect(pickerButton("Сессия в гавани")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Открыть Карта гавани" })).toBeInTheDocument();
    expect(api.documentImages).toHaveBeenCalledWith("session");
    expect(screen.queryByText("Скрытая заметка мастера")).not.toBeInTheDocument();
  });

  it("выбирает все типы текущей кампании и начинает с открытого документа", async () => {
    const docs = [npc, location, document({ id: "secret", type: "secret", title: "Тайна" }), document({ id: "other", campaignId: "c2", title: "Другая кампания" })];
    render(<PlayImages campaignId="c1" documents={docs} session={session} initialDocumentId="npc" playerScreen={controller()} />);
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
    await userEvent.click(pickerButton("Проводник"));
    const picker = screen.getByRole("dialog", { name: "Изображения сущностей" });
    await userEvent.click(within(picker).getByRole("button", { name: /Все сущности/ }));
    expect(within(picker).getAllByRole("button", { name: /^Открыть галерею/ })).toHaveLength(4);
    expect(within(picker).queryByRole("button", { name: /другая кампания/i })).not.toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("button", { name: "Открыть галерею Тайна" }));
    expect(api.documentImages).toHaveBeenLastCalledWith("secret");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("сохраняет ручной выбор при позднем обновлении списка сущностей", async () => {
    const view = render(<PlayImages campaignId="c1" documents={[npc]} session={session} playerScreen={controller()} />);
    await screen.findByRole("button", { name: "Открыть Карта гавани" });
    await chooseEntity("Проводник", "Сессия в гавани");
    view.rerender(<PlayImages campaignId="c1" documents={[npc, location]} session={session} initialDocumentId="location" playerScreen={controller()} />);
    expect(pickerButton("Проводник")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Открыть Проводник" })).toBeInTheDocument();
  });

  it("не показывает запоздавший ответ предыдущей сущности", async () => {
    const old = deferred<ImageAttachment[]>();
    vi.mocked(api.documentImages).mockImplementation((id) => id === "session" ? old.promise : Promise.resolve([portrait]));
    render(<PlayImages campaignId="c1" documents={[npc]} session={session} playerScreen={controller()} />);
    await chooseEntity("Проводник", "Сессия в гавани");
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
    expect(pickerButton("Сессия в гавани")).toBeInTheDocument();
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
