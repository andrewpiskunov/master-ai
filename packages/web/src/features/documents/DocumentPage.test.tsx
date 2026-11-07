import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Link, MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPage } from "./DocumentPage.js";
import { api } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";
import type { Document } from "@master-ai/shared";

vi.mock("../../api/client.js");
vi.mock("../../api/stream.js");
beforeEach(() => vi.resetAllMocks());
beforeEach(() => {
  vi.mocked(api.listDocumentLinks).mockResolvedValue({ outgoing: [], incoming: [] });
  vi.mocked(api.listCampaignDocuments).mockResolvedValue([]);
  vi.mocked(api.getDocumentConversation).mockResolvedValue([]);
});

function renderAt(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/documents/${id}`]}>
        <Routes>
          <Route path="/documents/:documentId" element={<DocumentPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("DocumentPage", () => {
  it("автоматически сохраняет изменения title", async () => {
    vi.mocked(api.getDocument).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: "active",
      contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "x",
    });
    vi.mocked(api.updateDocument).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон фон Кройц", status: "active",
      contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "y",
    });
    renderAt("d1");
    const title = await screen.findByLabelText(/заголовок/i);
    await userEvent.clear(title);
    await userEvent.type(title, "Барон фон Кройц");
    // Кнопки «Сохранить» больше нет — сохранение происходит само, с задержкой.
    expect(screen.queryByRole("button", { name: /сохранить/i })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(api.updateDocument).toHaveBeenCalledWith(
        "d1",
        expect.objectContaining({ title: "Барон фон Кройц" }),
      ),
    );
  });
});

it("opens an entity image panel with a gallery independent of document fields", async () => {
  vi.mocked(api.getDocument).mockResolvedValue({
    id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null,
    contentJson: null, fields: { tags: ["saved"] }, createdAt: "x", updatedAt: "x",
  });
  vi.mocked(api.documentImages).mockResolvedValue([{ id: "img1", name: "portrait.png", mimeType: "image/png" }]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  renderAt("d1");
  await userEvent.click(await screen.findByRole("button", { name: "Изображения" }));
  expect(await screen.findByAltText("portrait.png")).toHaveAttribute("src", "/api/images/img1/thumbnail?size=256");
  expect(api.updateDocument).not.toHaveBeenCalled();
});

const portrait = { id: "img1", name: "portrait.png", mimeType: "image/png" as const };
const tower = { id: "img2", name: "tower.png", mimeType: "image/png" as const };
const locationDoc: Document = {
  id: "d1", campaignId: "c1", type: "location", title: "Башня", status: null,
  contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Сохранённое описание" }] }] },
  fields: { tags: ["сохранено"] }, avatar: null, createdAt: "x", updatedAt: "x",
};

it("refreshes an already open gallery after an assistant action without replacing its draft", async () => {
  vi.mocked(api.getDocument).mockResolvedValueOnce(locationDoc).mockResolvedValue({ ...locationDoc, avatar: tower });
  vi.mocked(api.documentImages).mockResolvedValueOnce([]).mockResolvedValue([tower]);
  vi.mocked(api.assistantStatus).mockResolvedValue({ running: false, partial: "", error: null });
  vi.mocked(api.startAssistant).mockResolvedValue({ started: true });
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  let finish!: (messages: Awaited<ReturnType<typeof api.getDocumentConversation>>) => void;
  vi.mocked(api.getDocumentConversation).mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  renderAt("d1");
  await userEvent.type(await screen.findByRole("textbox", { name: "Сообщение помощнику" }), "Создай башню");
  await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await userEvent.click(screen.getByRole("button", { name: "Изображения" }));
  expect(await screen.findByText("Добавьте портрет, карту или референс.")).toBeInTheDocument();
  const prompt = screen.getByRole("textbox", { name: "Описание иллюстрации" });
  await userEvent.clear(prompt);
  await userEvent.type(prompt, "Мой следующий эскиз");
  await act(async () => finish([{ id: "reply", role: "assistant", content: "Готово.", createdAt: "x", meta: { imageAttachments: [{ documentId: "d1", documentTitle: "Башня", image: tower }] } }]));
  expect(await within(screen.getByRole("region", { name: "Изображения сущности" })).findByRole("button", { name: "Открыть tower.png" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Описание иллюстрации" })).toHaveValue("Мой следующий эскиз");
});

it("gives non-character entities an avatar placeholder that opens their image panel", async () => {
  vi.mocked(api.getDocument).mockResolvedValue(locationDoc);
  vi.mocked(api.documentImages).mockResolvedValue([]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  renderAt("d1");
  await userEvent.click(await screen.findByRole("button", { name: "Добавить аватар" }));
  expect(await screen.findByRole("region", { name: "Изображения сущности" })).toBeInTheDocument();
});

it("opens the resolved header avatar in the app and preserves an edited title on selection", async () => {
  vi.mocked(api.getDocument).mockResolvedValue({ ...locationDoc, avatar: portrait });
  vi.mocked(api.documentImages).mockResolvedValue([portrait, tower]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  vi.mocked(api.setDocumentAvatar).mockResolvedValue({ ...locationDoc, avatar: tower, fields: { avatarImageId: "img2" } });
  vi.mocked(api.updateDocument).mockImplementation(async (_id, patch) => ({ ...locationDoc, ...patch }));
  renderAt("d1");
  await userEvent.click(await screen.findByRole("button", { name: "Открыть аватар Башня" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Изменить аватар" }));
  const title = screen.getByLabelText("Заголовок");
  await userEvent.clear(title);
  await userEvent.type(title, "Новый заголовок");
  await userEvent.click(screen.getByRole("button", { name: "Сделать аватаром tower.png" }));
  const avatar = await screen.findByRole("button", { name: "Открыть аватар Новый заголовок" });
  await waitFor(() => expect(avatar.querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128"));
  expect(title).toHaveValue("Новый заголовок");
  expect(screen.getByText("Сохранённое описание")).toBeInTheDocument();
  expect(screen.getByText("сохранено")).toBeInTheDocument();
  await waitFor(() => expect(api.updateDocument).toHaveBeenCalledWith("d1", {
    title: "Новый заголовок", contentJson: locationDoc.contentJson,
  }));
});

it("refreshes the automatic avatar after attachment and clears it after detachment", async () => {
  vi.mocked(api.getDocument).mockResolvedValueOnce(locationDoc)
    .mockResolvedValueOnce({ ...locationDoc, avatar: portrait }).mockResolvedValue(locationDoc);
  vi.mocked(api.documentImages).mockResolvedValue([]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  vi.mocked(api.uploadImage).mockResolvedValue(portrait);
  vi.mocked(api.attachDocumentImage).mockResolvedValue([portrait]);
  vi.mocked(api.detachDocumentImage).mockResolvedValue([]);
  renderAt("d1");
  await userEvent.click(await screen.findByRole("button", { name: "Добавить аватар" }));
  await userEvent.upload(within(screen.getByRole("region", { name: "Изображения сущности" })).getByLabelText("Выбрать изображения"), new File(["png"], "portrait.png", { type: "image/png" }));
  await userEvent.click(await screen.findByRole("button", { name: "Прикрепить к сущности" }));
  expect(await screen.findByRole("button", { name: "Открыть аватар Башня" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Открепить portrait.png" }));
  expect(await screen.findByRole("button", { name: "Добавить аватар" })).toBeInTheDocument();
});

it("keeps a new avatar when an earlier tag save response arrives late", async () => {
  let finishTag!: (doc: Document) => void;
  vi.mocked(api.getDocument).mockResolvedValue({ ...locationDoc, avatar: portrait });
  vi.mocked(api.documentImages).mockResolvedValue([portrait, tower]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  vi.mocked(api.updateDocument).mockImplementation(() => new Promise((resolve) => { finishTag = resolve; }));
  vi.mocked(api.setDocumentAvatar).mockResolvedValue({ ...locationDoc, avatar: tower, fields: { ...locationDoc.fields, avatarImageId: tower.id } });
  renderAt("d1");
  await userEvent.click(await screen.findByRole("button", { name: "Добавить тег" }));
  await userEvent.type(screen.getByPlaceholderText("Тег…"), "новый{Enter}");
  await waitFor(() => expect(api.updateDocument).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Изменить аватар" }));
  await userEvent.click(await screen.findByRole("button", { name: "Сделать аватаром tower.png" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Открыть аватар Башня" }).querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128"));
  await act(async () => { finishTag({ ...locationDoc, avatar: portrait, fields: { ...locationDoc.fields, tags: ["сохранено", "новый"] } }); });
  expect(screen.getByRole("button", { name: "Открыть аватар Башня" }).querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128");
  expect(screen.getByText("новый")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Добавить тег" }));
  await userEvent.type(screen.getByPlaceholderText("Тег…"), "ещё{Enter}");
  expect(api.updateDocument).toHaveBeenLastCalledWith("d1", expect.objectContaining({ fields: expect.objectContaining({ avatarImageId: tower.id }) }));
});

it("keeps the selected avatar when an earlier type change response arrives late", async () => {
  let finishType!: (doc: Document) => void;
  vi.mocked(api.getDocument).mockResolvedValue({ ...locationDoc, avatar: portrait });
  vi.mocked(api.documentImages).mockResolvedValue([portrait, tower]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  vi.mocked(api.updateDocument).mockImplementation(() => new Promise((resolve) => { finishType = resolve; }));
  vi.mocked(api.setDocumentAvatar).mockResolvedValue({ ...locationDoc, avatar: tower, fields: { ...locationDoc.fields, avatarImageId: tower.id } });
  renderAt("d1");
  await userEvent.click(await screen.findByRole("button", { name: "Изменить тип" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Предмет" }));
  await userEvent.click(screen.getByRole("button", { name: "Изменить аватар" }));
  await userEvent.click(await screen.findByRole("button", { name: "Сделать аватаром tower.png" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Открыть аватар Башня" }).querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128"));
  await act(async () => { finishType({ ...locationDoc, type: "item", avatar: portrait }); });
  expect(screen.getByRole("button", { name: "Открыть аватар Башня" }).querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128");
});

it("keeps the next entity visible when the previous avatar refresh finishes late", async () => {
  let finish!: (doc: Document) => void;
  vi.mocked(api.getDocument).mockImplementation((id) => {
    if (id === "d2") return Promise.resolve({ ...locationDoc, id: "d2", title: "Замок", avatar: tower });
    if (vi.mocked(api.getDocument).mock.calls.length === 1) return Promise.resolve({ ...locationDoc, avatar: portrait });
    return new Promise((resolve) => { finish = resolve; });
  });
  vi.mocked(api.documentImages).mockResolvedValue([portrait]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  vi.mocked(api.detachDocumentImage).mockResolvedValue([]);
  render(<ToastProvider><MemoryRouter initialEntries={["/documents/d1"]}><Link to="/documents/d2">Следующий</Link><Routes><Route path="/documents/:documentId" element={<DocumentPage />} /></Routes></MemoryRouter></ToastProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "Изменить аватар" }));
  await userEvent.click(await screen.findByRole("button", { name: "Открепить portrait.png" }));
  await userEvent.click(screen.getByRole("link", { name: "Следующий" }));
  await screen.findByDisplayValue("Замок");
  await act(async () => { finish(locationDoc); });
  expect(screen.getByLabelText("Заголовок")).toHaveValue("Замок");
  expect(screen.getByRole("button", { name: "Открыть аватар Замок" }).querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128");
});

it("discards an old avatar refresh even after returning to the same entity route", async () => {
  let finish!: (doc: Document) => void;
  let requests = 0;
  vi.mocked(api.getDocument).mockImplementation((id) => {
    if (id === "d2") return Promise.resolve({ ...locationDoc, id: "d2", title: "Замок", avatar: tower });
    requests++;
    if (requests === 1) return Promise.resolve({ ...locationDoc, avatar: portrait });
    if (requests === 2) return new Promise((resolve) => { finish = resolve; });
    return Promise.resolve({ ...locationDoc, title: "Башня новая", avatar: tower });
  });
  vi.mocked(api.documentImages).mockResolvedValue([portrait]);
  vi.mocked(api.imageGenerationStatus).mockResolvedValue({ running: false, error: null });
  vi.mocked(api.detachDocumentImage).mockResolvedValue([]);
  render(<ToastProvider><MemoryRouter initialEntries={["/documents/d1"]}><Link to="/documents/d2">Следующий</Link><Link to="/documents/d1">Предыдущий</Link><Routes><Route path="/documents/:documentId" element={<DocumentPage />} /></Routes></MemoryRouter></ToastProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "Изменить аватар" }));
  await userEvent.click(await screen.findByRole("button", { name: "Открепить portrait.png" }));
  await userEvent.click(screen.getByRole("link", { name: "Следующий" }));
  await screen.findByDisplayValue("Замок");
  await userEvent.click(screen.getByRole("link", { name: "Предыдущий" }));
  await screen.findByDisplayValue("Башня новая");
  await act(async () => { finish(locationDoc); });
  expect(screen.getByLabelText("Заголовок")).toHaveValue("Башня новая");
  expect(screen.getByRole("button", { name: "Открыть аватар Башня новая" }).querySelector("img")).toHaveAttribute("src", "/api/images/img2/thumbnail?size=128");
});
