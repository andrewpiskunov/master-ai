import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import type { Document } from "@master-ai/shared";
import { MentionedInPanel } from "./MentionedInPanel.js";

function doc(id: string, title: string, bodyText: string): Document {
  return {
    id, campaignId: "c1", type: "npc", title, status: null,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: bodyText ? [{ type: "text", text: bodyText }] : [] }] },
    fields: {}, createdAt: "x", updatedAt: "x",
  };
}

describe("MentionedInPanel (smoke)", () => {
  it("показывает документы, где встречается название", () => {
    const documents = [
      doc("d1", "Барон", ""),
      doc("d2", "Гнилой Причал", "Здесь часто бывает Барон и его слуги."),
    ];
    render(
      <MemoryRouter>
        <MentionedInPanel campaignId="c1" documentId="d1" title="Барон" documents={documents} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Гнилой Причал")).toBeInTheDocument();
  });

  it("показывает пустое состояние, когда ссылок нет", () => {
    const documents = [doc("d1", "Барон", ""), doc("d2", "Причал", "Ничего общего.")];
    render(
      <MemoryRouter>
        <MentionedInPanel campaignId="c1" documentId="d1" title="Барон" documents={documents} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Пока никто не ссылается/)).toBeInTheDocument();
  });
});
