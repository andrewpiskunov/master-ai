import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import type { Document } from "@master-ai/shared";
import { CommandPalette } from "./CommandPalette.js";

function doc(over: Partial<Document>): Document {
  return { id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: { type: "doc", content: [] }, fields: {}, createdAt: "x", updatedAt: "x", ...over };
}

function renderPalette(over: { documents?: Document[]; onCreate?: (t: string) => void; onClose?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <CommandPalette campaignId="c1" documents={over.documents ?? []} onCreate={over.onCreate ?? vi.fn()} onClose={over.onClose ?? vi.fn()} />
    </MemoryRouter>,
  );
}

describe("CommandPalette (smoke)", () => {
  it("показывает базовые команды и документы", () => {
    renderPalette({ documents: [doc({ id: "s1", type: "session", title: "Сессия 1" })] });
    expect(screen.getByText("Обзор")).toBeInTheDocument();
    expect(screen.getByText("Новый документ")).toBeInTheDocument();
    expect(screen.getByText("Запустить: Сессия 1")).toBeInTheDocument();
  });

  it("фильтрует по запросу", async () => {
    renderPalette({ documents: [doc({ title: "Барон" })] });
    await userEvent.type(screen.getByPlaceholderText("Команда или документ…"), "барон");
    expect(screen.getByText("Барон")).toBeInTheDocument();
    expect(screen.queryByText("Обзор")).not.toBeInTheDocument();
  });

  it("«Новый документ» вызывает onCreate", async () => {
    const onCreate = vi.fn();
    renderPalette({ onCreate });
    await userEvent.click(screen.getByText("Новый документ"));
    expect(onCreate).toHaveBeenCalledWith("note");
  });
});
