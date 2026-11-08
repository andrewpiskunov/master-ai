import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantAnswer } from "./AssistantAnswer.js";
const block = (text: string) => `\n\`\`\`edit-doc\nid: npc\ntitle: Проводник\nrename: Иван Проводник\n---\n${text}\n\`\`\``;
describe("edit proposal presentation", () => {
  it("does not mark an ID-based edit complete just because another card already has the proposed name", () => {
    render(<AssistantAnswer content={block("Новое описание")} stale={false} currentText="" appliedBlocks={[]} documents={[{ id: "other", title: "Иван Проводник", type: "npc" }]} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Обновить «Иван Проводник»" })).toBeInTheDocument();
  });
  it("offers review for legacy edits when another card already has the requested name", () => {
    render(<AssistantAnswer content={block("Новое описание").replace("id: npc\n", "")} stale={false} currentText="" appliedBlocks={[]} documents={[{ title: "Проводник", type: "npc" }, { title: "Иван Проводник", type: "npc" }]} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Обновить «Иван Проводник»" })).toBeInTheDocument();
  });
  it("marks only the saved proposal when one answer has two edits to the same card", async () => {
    render(<AssistantAnswer content={block("Первая правка") + block("Вторая правка")} stale={false} currentText="" appliedBlocks={[]} documents={[]} onApply={vi.fn()} onCreateEntity={vi.fn()} onEditEntity={async () => true} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Обновить «Иван Проводник»" })[0]);
    expect(await screen.findByText("«Иван Проводник» обновлено")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Обновить «Иван Проводник»" })).toHaveLength(1);
  });
});
