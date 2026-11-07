import { userEvent } from "@testing-library/user-event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
