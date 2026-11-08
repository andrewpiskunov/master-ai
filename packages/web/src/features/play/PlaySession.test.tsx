import { userEvent } from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlaySession } from "./PlaySession.js";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";

vi.mock("../../api/client.js");
vi.mock("../../api/stream.js");
const playerScreen = vi.hoisted(() => ({ image: null, captionVisible: false, error: "", open: vi.fn(), show: vi.fn(), clear: vi.fn() }));
vi.mock("./usePlayerScreen.js", () => ({ usePlayerScreen: () => playerScreen }));

const sessionDoc = {
  id: "d1", campaignId: "c1", type: "session", title: "Сессия 1", status: null,
  contentJson: { type: "doc", content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Завязка" }] },
    { type: "paragraph", content: [{ type: "text", text: "Партия в порту." }] },
  ] },
  fields: { sessionNumber: 1 }, createdAt: "x", updatedAt: "x",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getDocument).mockResolvedValue(sessionDoc);
  vi.mocked(api.getCampaign).mockResolvedValue({ id: "c1", name: "Корона", system: null, description: "", realism: "balanced", llmProvider: "cli" as const, llmSettings: {}, createdAt: "x" });
  vi.mocked(api.listCampaignDocuments).mockResolvedValue([]);
  vi.mocked(api.getDocumentConversation).mockResolvedValue([]);
  vi.mocked(api.assistantStatus).mockResolvedValue({ running: false, partial: "", error: null });
});

describe("PlaySession (smoke)", () => {
  it("рендерит режим игры: вкладки чата и «Следующая сессия»", async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/campaigns/c1/sessions/d1/play"]}>
          <Routes><Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} /></Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText("Сценарий")).toBeInTheDocument();
    expect(screen.getByText("Документы")).toBeInTheDocument();
    expect(screen.getByText("Бой")).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll(".play-session-tabs button"), (button) => button.textContent)).toEqual(["Сценарий", "Документы", "Изображения", "Бой"]);
    expect(screen.getByRole("button", { name: /Следующая сессия/ })).toBeInTheDocument();
  });
});

function renderSession() {
  return render(<ToastProvider><MemoryRouter initialEntries={["/campaigns/c1/sessions/d1/play"]}>
    <Routes><Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} /></Routes>
  </MemoryRouter></ToastProvider>);
}

describe("native entity links in play mode", () => {
  const npc = { ...sessionDoc, id: "npc", type: "npc", title: "Проводник" };
  function prepare(chat = false) {
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([npc]);
    if (chat) vi.mocked(api.getDocumentConversation).mockResolvedValue([{ id: "m1", role: "assistant", content: "Здесь ждёт Проводник.", createdAt: "x" }]);
    else vi.mocked(api.getDocument).mockResolvedValue({ ...sessionDoc, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Здесь ждёт Проводник." }] }] } });
    renderSession();
  }

  it.each([false, true])("gives %s chat/scenario mentions a canonical URL and keeps plain clicks in the document viewer", async (chat) => {
    prepare(chat);
    const link = await screen.findByText("Проводник", { selector: "a.mention" });
    expect(link).toHaveAttribute("href", "/campaigns/c1/documents/npc");
    await userEvent.click(link);
    expect(document.querySelector(".play-viewer-title")).toHaveTextContent("Проводник");
    expect(document.querySelector(".play-viewer")).toBeVisible();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it.each([false, true])("leaves context menus, middle-click and modifier clicks to the browser (chat=%s)", async (chat) => {
    prepare(chat);
    const link = await screen.findByText("Проводник", { selector: "a.mention" });
    expect(link).toHaveAttribute("href", "/campaigns/c1/documents/npc");
    for (const [type, options] of [
      ["contextmenu", { button: 2 }], ["auxclick", { button: 1 }],
      ["click", { button: 0, metaKey: true }], ["click", { button: 0, ctrlKey: true }],
      ["click", { button: 0, shiftKey: true }], ["click", { button: 0, altKey: true }],
    ] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
      let preventedByApp: boolean | undefined;
      // Проверяем обработчики приложения, затем останавливаем отсутствующую
      // в JSDOM нативную навигацию на самом последнем уровне всплытия.
      document.addEventListener(type, (nativeEvent) => {
        preventedByApp = nativeEvent.defaultPrevented;
        nativeEvent.preventDefault();
      }, { once: true });
      fireEvent(link, event);
      expect(preventedByApp).toBe(false);
      expect(document.querySelector(".play-viewer-title")).toBeNull();
    }
  });

  it("keeps cycling same-named scenario entities while the native URL points at the first match", async () => {
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([npc, { ...npc, id: "npc2" }]);
    vi.mocked(api.getDocument).mockResolvedValue({ ...sessionDoc, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Проводник." }] }] } });
    renderSession();
    const link = await screen.findByText("Проводник", { selector: "a.play-link" });
    expect(link).toHaveAttribute("href", "/campaigns/c1/documents/npc");
    expect(link).toHaveAttribute("data-doc-ids", "npc,npc2");
    await userEvent.click(link);
    expect(screen.getByRole("button", { name: "Изображения: Проводник" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Сценарий" }));
    await userEvent.click(link);
    await userEvent.click(screen.getByRole("button", { name: "Закрепить" }));
    expect(api.updateDocument).toHaveBeenCalledWith("d1", { fields: expect.objectContaining({ pins: ["npc2"] }) });
  });
});

describe("PlaySession images", () => {
  it("предлагает отдельный экран игроков и не загружает галерею до выбора вкладки", async () => {
    renderSession();
    expect(await screen.findByRole("button", { name: "Экран игроков" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Изображения" })).toBeInTheDocument();
    expect(api.documentImages).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Экран игроков" }));
    expect(playerScreen.open).toHaveBeenCalledOnce();
    expect(api.documentImages).not.toHaveBeenCalled();
  });

  it("открывает изображения сессии во вкладке", async () => {
    vi.mocked(api.documentImages).mockResolvedValue([{ id: "map", name: "Карта", mimeType: "image/png" }]);
    renderSession();
    await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
    expect(await screen.findByRole("button", { name: "Открыть Карта" })).toBeInTheDocument();
    expect(api.documentImages).toHaveBeenCalledWith("d1");
  });

  it("открывает галерею сущности из просмотра упоминания в сценарии", async () => {
    const npc = { ...sessionDoc, id: "npc", type: "npc", title: "Проводник" };
    vi.mocked(api.getDocument).mockResolvedValue({ ...sessionDoc, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Вас встречает Проводник." }] }] } });
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([npc]);
    vi.mocked(api.documentImages).mockResolvedValue([{ id: "portrait", name: "Портрет", mimeType: "image/png" }]);
    renderSession();
    await userEvent.click(await screen.findByText("Проводник", { selector: "a.play-link" }));
    await userEvent.click(screen.getByRole("button", { name: "Изображения: Проводник" }));
    expect(await screen.findByRole("button", { name: "Открыть Портрет" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выбрать сущность: Проводник" })).toBeInTheDocument();
    expect(api.documentImages).toHaveBeenCalledWith("npc");
  });
  it("передаёт выбранное изображение экрану игроков с выключенной подписью", async () => {
    const image = { id: "map", name: "Карта", mimeType: "image/png" as const };
    vi.mocked(api.documentImages).mockResolvedValue([image]);
    renderSession();
    await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
    await userEvent.click(await screen.findByRole("button", { name: "Показать игрокам Карта" }));
    expect(playerScreen.show).toHaveBeenCalledWith(image, false);
  });

  it("обновляет открытую галерею после действия с изображением в игровом чате", async () => {
    const image = { id: "map", name: "Карта", mimeType: "image/png" as const };
    vi.mocked(api.documentImages).mockResolvedValueOnce([]).mockResolvedValue([image]);
    vi.mocked(api.startAssistant).mockResolvedValue({ started: true });
    vi.mocked(api.getDocumentConversation).mockResolvedValueOnce([]).mockResolvedValue([
      { id: "answer", role: "assistant", content: "Иллюстрация создана.", createdAt: "x", meta: { imageAttachments: [{ documentId: "d1", documentTitle: "Сессия 1", image }] } },
    ]);
    renderSession();
    await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
    expect(await screen.findByText("У этой сущности пока нет изображений")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Сообщение ИИ-мастеру" }), "Создай карту");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(api.documentImages).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Показать игрокам Карта" })).toBeInTheDocument();
    expect(api.updateDocument).not.toHaveBeenCalled();
  });

  it("сразу выбирает сущность с изображением, если у сессии нет своей картинки", async () => {
    const image = { id: "portrait", name: "Портрет", mimeType: "image/png" as const };
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([{ ...sessionDoc, id: "npc", type: "npc", title: "Проводник", avatar: image }]);
    vi.mocked(api.documentImages).mockResolvedValue([image]);
    renderSession();
    await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
    expect(await screen.findByRole("button", { name: "Выбрать сущность: Проводник" })).toBeInTheDocument();
    expect(api.documentImages).toHaveBeenLastCalledWith("npc");
  });

  it("игнорирует запоздалую загрузку предыдущей сессии после смены маршрута", async () => {
    let resolveOld!: (value: typeof sessionDoc) => void;
    const old = new Promise<typeof sessionDoc>((resolve) => { resolveOld = resolve; });
    vi.mocked(api.getDocument).mockImplementation((id) => id === "d1" ? old : Promise.resolve({ ...sessionDoc, id: "d2", title: "Сессия 2" }));
    function SwitchSession() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/campaigns/c1/sessions/d2/play")}>Другая сессия</button>;
    }
    render(<ToastProvider><MemoryRouter initialEntries={["/campaigns/c1/sessions/d1/play"]}>
      <SwitchSession /><Routes><Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} /></Routes>
    </MemoryRouter></ToastProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Другая сессия" }));
    expect(await screen.findByText("Сессия 2")).toBeInTheDocument();
    await act(async () => resolveOld(sessionDoc));
    expect(screen.getByText("Сессия 2")).toBeInTheDocument();
    expect(screen.queryByText("Сессия 1")).not.toBeInTheDocument();
  });

});

describe("fresh campaign characters in an already open session", () => {
  const pc = { ...sessionDoc, id: "steven", type: "pc", title: "Стивен", avatar: { id: "portrait", name: "Стивен — портрет.png", mimeType: "image/png" as const } };

  it.each(["focus", "visibilitychange"])("loads newly created characters on %s without changing the session", async (event) => {
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([sessionDoc]);
    renderSession();
    await screen.findByRole("button", { name: "Следующая сессия" });
    expect(screen.queryByRole("button", { name: "Стивен" })).toBeNull();
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([sessionDoc, pc]);
    fireEvent(event === "focus" ? window : document, new Event(event));
    expect(await screen.findByRole("button", { name: "Стивен" })).toBeInTheDocument();
    expect(screen.getByText("Завязка")).toBeVisible();
    expect(api.updateDocument).not.toHaveBeenCalled();
  });

  it("loads new characters when opening the image tab", async () => {
    vi.mocked(api.listCampaignDocuments).mockResolvedValueOnce([sessionDoc]).mockResolvedValue([sessionDoc, pc]);
    vi.mocked(api.documentImages).mockResolvedValue([]);
    renderSession();
    await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
    await userEvent.click(await screen.findByRole("button", { name: "Выбрать сущность: Стивен" }));
    expect(screen.getByRole("button", { name: "Открыть галерею Стивен" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Персонаж игрока" })).toBeInTheDocument();
  });

  it("refreshes characters when reopening the picker inside the image tab", async () => {
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([sessionDoc]);
    vi.mocked(api.documentImages).mockResolvedValue([]);
    renderSession();
    await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
    const picker = await screen.findByRole("button", { name: "Выбрать сущность: Сессия 1" });
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([sessionDoc, pc]);
    await userEvent.click(picker);
    expect(await screen.findByRole("button", { name: "Открыть галерею Стивен" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Персонаж игрока" })).toBeInTheDocument();
  });
});

describe("mentions inside the in-session document viewer", () => {
  const npc = { ...sessionDoc, id: "npc", type: "npc", title: "Хелена Бауэр" };
  const location = { ...sessionDoc, id: "hospital", type: "location", title: "Больница Мерси" };
  const scene = { ...sessionDoc, id: "scene", type: "scene", title: "Дело у постели", contentJson: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Дело у постели. Больница Мерси; Хелена Бауэр. Сессия 1." }] },
  ] } };

  async function openScene() {
    vi.mocked(api.getDocument).mockResolvedValue({ ...sessionDoc, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Дело у постели." }] }] } });
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([sessionDoc, scene, npc, location]);
    renderSession();
    await userEvent.click(await screen.findByRole("link", { name: "Дело у постели" }));
    return within(document.querySelector<HTMLElement>(".play-viewer-body")!);
  }

  it("links characters, locations and the session, and navigates between cards with history", async () => {
    const viewer = await openScene();
    const person = viewer.getByRole("link", { name: "Хелена Бауэр" });
    expect(person).toHaveClass("mention-npc");
    expect(person).toHaveAttribute("href", "/campaigns/c1/documents/npc");
    expect(viewer.getByRole("link", { name: "Больница Мерси" })).toHaveClass("mention-location");
    expect(viewer.getByRole("link", { name: "Сессия 1" })).toHaveAttribute("href", "/campaigns/c1/documents/d1");
    expect(viewer.queryByRole("link", { name: "Дело у постели" })).toBeNull();
    await userEvent.click(person);
    expect(document.querySelector(".play-viewer-title")).toHaveTextContent("Хелена Бауэр");
    await userEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(document.querySelector(".play-viewer-title")).toHaveTextContent("Дело у постели");
    await userEvent.click(viewer.getByRole("link", { name: "Больница Мерси" }));
    expect(document.querySelector(".play-viewer-title")).toHaveTextContent("Больница Мерси");
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it("keeps right-click and modified clicks native inside viewed cards", async () => {
    const viewer = await openScene();
    const person = viewer.getByRole("link", { name: "Хелена Бауэр" });
    for (const [type, options] of [
      ["contextmenu", { button: 2 }], ["auxclick", { button: 1 }],
      ["click", { button: 0, metaKey: true }], ["click", { button: 0, ctrlKey: true }],
      ["click", { button: 0, shiftKey: true }],
    ] as const) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
      let preventedByApp: boolean | undefined;
      document.addEventListener(type, (nativeEvent) => {
        preventedByApp = nativeEvent.defaultPrevented;
        nativeEvent.preventDefault();
      }, { once: true });
      fireEvent(person, event);
      expect(preventedByApp).toBe(false);
      expect(document.querySelector(".play-viewer-title")).toHaveTextContent("Дело у постели");
    }
  });
});

describe("editing existing campaign cards during play", () => {
  it("reviews an NPC edit and refreshes the open in-session viewer after saving", async () => {
    const npc = { ...sessionDoc, id: "npc", type: "npc", title: "Проводник", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Старое описание проводника" }] }] }, fields: { health: 7 }, updatedAt: "2026-01-01T00:00:00Z" };
    const updated = { ...npc, title: "Иван Проводник", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Новое описание проводника" }] }] } };
    vi.mocked(api.getDocument).mockImplementation(async (id) => id === "npc" ? npc : sessionDoc);
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([sessionDoc, npc]);
    vi.mocked(api.updateDocument).mockResolvedValue(updated);
    vi.mocked(api.getDocumentConversation).mockResolvedValue([{ id: "edit", role: "assistant", content: 'Правка: Проводник.\n```edit-doc\nid: npc\ntitle: Проводник\nrename: Иван Проводник\n---\nНовое описание проводника\n```', createdAt: "x" }]);
    renderSession();
    const link = await screen.findByRole("link", { name: "Проводник" }); fireEvent.click(link);
    expect(document.querySelector(".play-viewer")).toHaveTextContent("Старое описание проводника");
    await userEvent.click(screen.getByRole("button", { name: "Обновить «Иван Проводник»" }));
    const modal = await screen.findByRole("dialog", { name: "Изменить карточку" });
    expect(modal).toHaveTextContent("Старое описание проводника"); expect(api.updateDocument).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(document.querySelector(".play-viewer")).toHaveTextContent("Новое описание проводника"));
    expect(document.querySelector(".play-viewer")).toHaveTextContent("Иван Проводник");
    expect(api.updateDocument).toHaveBeenCalledWith("npc", expect.objectContaining({ expectedUpdatedAt: "2026-01-01T00:00:00Z" }));
    expect(screen.queryByText("Изменяйте документы вне режима игры")).not.toBeInTheDocument();
  });
});
