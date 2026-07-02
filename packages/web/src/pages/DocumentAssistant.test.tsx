import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentAssistant, blockKey, type NewEntity, type EditEntity } from "./DocumentAssistant.js";
import { api } from "../api/client.js";
import { streamComplete } from "../api/stream.js";
import { ToastProvider } from "../ui/toast.js";

vi.mock("../api/client.js");
vi.mock("../api/stream.js");

const fence = "```";

function renderAssistant(over: {
  messages?: { role: "user" | "assistant"; content: string; createdAt?: string }[];
  documents?: { title: string; type: string }[];
  getText?: () => string;
  appliedBlocks?: string[];
  docUpdatedAt?: string;
  onApply?: (t: string) => void;
  onCreateEntity?: (e: NewEntity) => void;
  onEditEntity?: (e: EditEntity) => void;
} = {}) {
  vi.mocked(api.getDocumentConversation).mockResolvedValue(
    (over.messages ?? []).map((m, i) => ({ id: `m${i}`, conversationId: "cv", role: m.role, content: m.content, createdAt: m.createdAt ?? "x" })),
  );
  return render(
    <ToastProvider>
      <DocumentAssistant
        docId="d1"
        title="Тест"
        typeLabel="Заметка"
        documents={over.documents ?? []}
        getText={over.getText ?? (() => "")}
        appliedBlocks={over.appliedBlocks}
        docUpdatedAt={over.docUpdatedAt}
        onApply={over.onApply ?? vi.fn()}
        onCreateEntity={over.onCreateEntity ?? vi.fn()}
        onEditEntity={over.onEditEntity ?? vi.fn()}
      />
    </ToastProvider>,
  );
}

describe("DocumentAssistant карточки (smoke)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("показывает diff-правку документа и применяет её", async () => {
    const onApply = vi.fn();
    renderAssistant({ messages: [{ role: "assistant", content: `Правка.\n${fence}doc\n## Цель\nНовая цель\n${fence}` }], onApply });
    const btn = await screen.findByRole("button", { name: /Применить к документу/ });
    expect(document.querySelector(".apply-diff")).toBeTruthy();
    await userEvent.click(btn);
    expect(onApply).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText(/Применено к документу/)).toBeInTheDocument());
  });

  it("apply-карточка свёрнута, если блок уже отмечен применённым (переживает перезаход)", async () => {
    const inner = "## Цель\nНовая цель"; // содержимое блока ```doc```, по нему считается ключ
    renderAssistant({
      messages: [{ role: "assistant", content: `Правка.\n${fence}doc\n${inner}\n${fence}` }],
      appliedBlocks: [blockKey(inner)],
    });
    expect(await screen.findByText(/Применено к документу/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Применить к документу/ })).not.toBeInTheDocument();
  });

  it("карточка без ключа помечается устаревшей, если документ менялся после сообщения", async () => {
    renderAssistant({
      messages: [{ role: "assistant", content: `Правка.\n${fence}doc\n## Цель\nНовая цель\n${fence}`, createdAt: "2026-07-01T10:00:00.000Z" }],
      getText: () => "Совсем другой текст",
      docUpdatedAt: "2026-07-01T12:00:00.000Z",
    });
    expect(await screen.findByText(/Документ менялся после этого предложения/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Применить к документу$/ })).not.toBeInTheDocument();
    // применить всё равно можно, но второстепенной кнопкой
    expect(screen.getByRole("button", { name: /Применить всё равно/ })).toBeInTheDocument();
  });

  it("карточка активна, если документ не менялся после сообщения", async () => {
    renderAssistant({
      messages: [{ role: "assistant", content: `Правка.\n${fence}doc\n## Цель\nНовая цель\n${fence}`, createdAt: "2026-07-01T12:00:00.000Z" }],
      getText: () => "Старый текст",
      docUpdatedAt: "2026-07-01T10:00:00.000Z",
    });
    expect(await screen.findByRole("button", { name: /Применить к документу/ })).toBeInTheDocument();
    expect(screen.queryByText(/Документ менялся после этого предложения/)).not.toBeInTheDocument();
  });

  it("персистентный ключ важнее устаревания: блок с ключом показан применённым", async () => {
    const inner = "## Цель\nНовая цель";
    renderAssistant({
      messages: [{ role: "assistant", content: `Правка.\n${fence}doc\n${inner}\n${fence}`, createdAt: "2026-07-01T10:00:00.000Z" }],
      appliedBlocks: [blockKey(inner)],
      getText: () => "Совсем другой текст",
      docUpdatedAt: "2026-07-01T12:00:00.000Z",
    });
    expect(await screen.findByText(/Применено к документу/)).toBeInTheDocument();
    expect(screen.queryByText(/Документ менялся после этого предложения/)).not.toBeInTheDocument();
  });

  it("карточка создания сущности: активна, когда сущности ещё нет", async () => {
    const onCreateEntity = vi.fn();
    renderAssistant({
      messages: [{ role: "assistant", content: `Идея.\n${fence}new-doc\ntype: npc\ntitle: Барон\n---\nЗлодей.\n${fence}` }],
      documents: [],
      onCreateEntity,
    });
    const btn = await screen.findByRole("button", { name: /Создать сущность «Барон»/ });
    await userEvent.click(btn);
    expect(onCreateEntity).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText(/Сущность «Барон» создана/)).toBeInTheDocument());
  });

  it("карточка создания свёрнута, если сущность уже есть в кампании", async () => {
    renderAssistant({
      messages: [{ role: "assistant", content: `Идея.\n${fence}new-doc\ntype: npc\ntitle: Барон\n---\nЗлодей.\n${fence}` }],
      documents: [{ title: "Барон", type: "npc" }],
    });
    expect(await screen.findByText(/Сущность «Барон» создана/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Создать сущность/ })).not.toBeInTheDocument();
  });

  it("«Очистить беседу»: двухшаговое подтверждение, чат пустеет", async () => {
    vi.mocked(api.clearDocumentConversation).mockResolvedValue(undefined);
    renderAssistant({ messages: [{ role: "assistant", content: "Старый ответ" }] });
    expect(await screen.findByText("Старый ответ")).toBeInTheDocument();
    const clear = screen.getByRole("button", { name: /Очистить беседу/ });
    await userEvent.click(clear);
    // первый клик — только подтверждение, ничего не удалено
    expect(api.clearDocumentConversation).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Точно очистить\?/ }));
    await waitFor(() => expect(screen.queryByText("Старый ответ")).not.toBeInTheDocument());
    expect(api.clearDocumentConversation).toHaveBeenCalledWith("d1");
  });

  it("кнопка «Стоп» прерывает генерацию, набранный текст остаётся", async () => {
    vi.mocked(api.addDocumentMessage).mockResolvedValue({ id: "m", role: "user", content: "", createdAt: "x" });
    // стрим отдаёт кусок и «висит», пока его не прервут по signal
    vi.mocked(streamComplete).mockImplementation((_input, onChunk, signal) => {
      onChunk("Начало ответа…");
      return new Promise((resolve) => signal?.addEventListener("abort", () => resolve("Начало ответа…")));
    });
    renderAssistant();
    const input = await screen.findByPlaceholderText(/Спросите про документ/);
    await userEvent.type(input, "Расскажи о документе");
    await userEvent.click(screen.getByRole("button", { name: /Отправить/ }));
    // идёт генерация: вместо «Отправить» — «Стоп», кусок ответа уже на экране
    const stop = await screen.findByRole("button", { name: /Стоп/ });
    expect(screen.getByText("Начало ответа…")).toBeInTheDocument();
    await userEvent.click(stop);
    // генерация остановлена: «Отправить» вернулась, частичный ответ остался
    expect(await screen.findByRole("button", { name: /Отправить/ })).toBeInTheDocument();
    expect(screen.getByText("Начало ответа…")).toBeInTheDocument();
  });

  it("карточка правки свёрнута для переименования, если новый документ уже есть", async () => {
    renderAssistant({
      messages: [{ role: "assistant", content: `Правка.\n${fence}edit-doc\ntitle: Старый\nrename: Новый\n---\nтекст\n${fence}` }],
      documents: [{ title: "Новый", type: "npc" }],
    });
    expect(await screen.findByText(/«Новый» обновлено/)).toBeInTheDocument();
  });
});
