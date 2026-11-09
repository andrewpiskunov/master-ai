import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@master-ai/shared";
import { api, ApiError } from "../../api/client.js";
import { ToastProvider } from "../../ui/toast.js";
import type { EditEntity } from "../assistant/assistant-blocks.js";
import { useGameEntityEdits } from "./GameEntityEdits.js";

vi.mock("../../api/client.js", async (original) => ({ ...await original<typeof import("../../api/client.js")>(), api: { listCampaignDocuments: vi.fn(), getDocument: vi.fn(), updateDocument: vi.fn() } }));
const doc: Document = { id: "npc", campaignId: "c", type: "npc", title: "Проводник", status: "alive", fields: { health: 7, avatarImageId: "portrait", tags: ["союзник"] }, avatar: { id: "portrait", name: "Портрет", mimeType: "image/png" }, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Старое описание" }] }] }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
const edit: EditEntity = { documentId: "npc", title: "Проводник", rename: "Иван Проводник", text: "Новое описание" };
const saved = vi.fn();
function Harness({ proposal = edit, sessionId = "session" }: { proposal?: EditEntity; sessionId?: string }) {
  const [result, setResult] = useState("");
  const { requestEdit, dialog } = useGameEntityEdits({ campaignId: "c", sessionId, onSaved: saved });
  return <><button onClick={() => { void requestEdit(proposal).then((ok) => { setResult(ok ? "saved" : "cancelled"); }); }}>Предложенная правка</button><p>{result}</p>{dialog}</>;
}
function mount(proposal = edit) { return render(<ToastProvider><Harness proposal={proposal} /></ToastProvider>); }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.listCampaignDocuments).mockResolvedValue([doc]); vi.mocked(api.getDocument).mockResolvedValue(doc); vi.mocked(api.updateDocument).mockResolvedValue({ ...doc, title: "Иван Проводник" }); });
const review = async () => { fireEvent.click(screen.getByRole("button", { name: "Предложенная правка" })); return await screen.findByRole("dialog", { name: "Изменить карточку" }); };

describe("existing card edits in play", () => {
  it("reviews current and proposed text before conditionally saving only title and content", async () => {
    mount(); const modal = await review();
    expect(within(modal).getByText("Старое описание")).toBeInTheDocument(); expect(within(modal).getByText("Новое описание")).toBeInTheDocument();
    expect(api.updateDocument).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(screen.getByText("saved")).toBeInTheDocument());
    expect(api.updateDocument).toHaveBeenCalledWith("npc", { title: "Иван Проводник", contentJson: expect.any(Object), expectedUpdatedAt: "2026-01-02T00:00:00Z" });
    expect(JSON.stringify(vi.mocked(api.updateDocument).mock.calls[0][1].contentJson)).toContain("Новое описание");
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: "npc", fields: doc.fields, status: "alive", avatar: doc.avatar }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("cancels without saving and does not falsely mark a rejected proposal as applied", async () => {
    mount(); const modal = await review(); fireEvent.click(within(modal).getByRole("button", { name: "Отмена" }));
    await screen.findByText("cancelled"); expect(api.updateDocument).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  });
  it("resolves legacy title-only proposals, but refuses ambiguous names", async () => {
    vi.mocked(api.listCampaignDocuments).mockResolvedValue([doc, { ...doc, id: "other-npc" }]);
    mount({ title: "Проводник", text: "Правка" }); fireEvent.click(screen.getByRole("button", { name: "Предложенная правка" }));
    expect(await screen.findByText(/несколько карточек/i)).toBeInTheDocument(); expect(api.updateDocument).not.toHaveBeenCalled();
  });
  it("does not edit a foreign or missing ID", async () => {
    mount({ ...edit, documentId: "foreign" }); fireEvent.click(screen.getByRole("button", { name: "Предложенная правка" }));
    expect(await screen.findByText(/не найден/i)).toBeInTheDocument(); expect(api.getDocument).not.toHaveBeenCalled();
  });
  it("reloads a changed card after a conflict and requires review again", async () => {
    const changed = { ...doc, updatedAt: "2026-01-03T00:00:00Z", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Правка из другого окна" }] }] } };
    vi.mocked(api.getDocument).mockResolvedValueOnce(doc).mockResolvedValue(changed);
    vi.mocked(api.updateDocument).mockRejectedValueOnce(new ApiError(409, "Документ изменился")).mockResolvedValue({ ...changed, title: edit.rename! });
    mount(); const modal = await review(); fireEvent.click(within(modal).getByRole("button", { name: "Сохранить изменения" }));
    expect(await within(modal).findByText("Правка из другого окна")).toBeInTheDocument(); expect(saved).not.toHaveBeenCalled();
    expect(within(modal).getByText(/изменилась/i)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "Сохранить изменения" }));
    await screen.findByText("saved"); expect(api.updateDocument).toHaveBeenLastCalledWith("npc", expect.objectContaining({ expectedUpdatedAt: "2026-01-03T00:00:00Z" }));
  });
  it("keeps the review open on a save error without reporting success", async () => {
    vi.mocked(api.updateDocument).mockRejectedValue(new Error("Нет связи")); mount(); const modal = await review();
    fireEvent.click(within(modal).getByRole("button", { name: "Сохранить изменения" }));
    expect(await within(modal).findByText("Нет связи")).toBeInTheDocument(); expect(saved).not.toHaveBeenCalled(); expect(screen.queryByText("saved")).not.toBeInTheDocument();
  });
  it("does not open an old review after switching sessions while loading", async () => {
    let finish!: (doc: Document) => void; vi.mocked(api.getDocument).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Предложенная правка" }));
    await waitFor(() => expect(api.getDocument).toHaveBeenCalled());
    view.rerender(<ToastProvider><Harness sessionId="another" /></ToastProvider>);
    await act(async () => { finish(doc); }); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(saved).not.toHaveBeenCalled();
  });
});
