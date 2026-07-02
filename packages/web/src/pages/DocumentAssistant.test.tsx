import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentAssistant, blockKey, type NewEntity, type EditEntity } from "./DocumentAssistant.js";
import { api } from "../api/client.js";
import { ToastProvider } from "../ui/toast.js";

vi.mock("../api/client.js");
vi.mock("../api/stream.js");

const fence = "```";

function renderAssistant(over: {
  messages?: { role: "user" | "assistant"; content: string }[];
  documents?: { title: string; type: string }[];
  getText?: () => string;
  appliedBlocks?: string[];
  onApply?: (t: string) => void;
  onCreateEntity?: (e: NewEntity) => void;
  onEditEntity?: (e: EditEntity) => void;
} = {}) {
  vi.mocked(api.getDocumentConversation).mockResolvedValue(
    (over.messages ?? []).map((m, i) => ({ id: `m${i}`, conversationId: "cv", role: m.role, content: m.content, createdAt: "x" })),
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

  it("карточка правки свёрнута для переименования, если новый документ уже есть", async () => {
    renderAssistant({
      messages: [{ role: "assistant", content: `Правка.\n${fence}edit-doc\ntitle: Старый\nrename: Новый\n---\nтекст\n${fence}` }],
      documents: [{ title: "Новый", type: "npc" }],
    });
    expect(await screen.findByText(/«Новый» обновлено/)).toBeInTheDocument();
  });
});
