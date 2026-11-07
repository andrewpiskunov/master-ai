import { userEvent } from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("button", { name: /Следующая сессия/ })).toBeInTheDocument();
  });
});

function renderSession() {
  return render(<ToastProvider><MemoryRouter initialEntries={["/campaigns/c1/sessions/d1/play"]}>
    <Routes><Route path="/campaigns/:campaignId/sessions/:documentId/play" element={<PlaySession />} /></Routes>
  </MemoryRouter></ToastProvider>);
}

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
    expect(screen.getByLabelText("Изображения сущности")).toHaveValue("npc");
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
