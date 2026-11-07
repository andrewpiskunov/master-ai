import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DocumentEditor, markdownToDoc, textToHtml } from "./DocumentEditor.js";

describe("DocumentEditor", () => {
  it("рендерит переданный контент", async () => {
    render(<DocumentEditor content={markdownToDoc("Серый Прелат — хозяин нор.")} onChange={vi.fn()} />);
    expect(await screen.findByText(/Серый Прелат/)).toBeInTheDocument();
  });

  it("больше не показывает панель форматирования и кнопку «Дописать ИИ»", async () => {
    render(<DocumentEditor content={markdownToDoc("текст")} onChange={vi.fn()} />);
    await screen.findByText("текст");
    expect(screen.queryByRole("button", { name: /дописать/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ж$/i })).not.toBeInTheDocument();
  });

  it("подсказывает про «@» под полем", async () => {
    render(<DocumentEditor content={markdownToDoc("текст")} onChange={vi.fn()} />);
    expect(await screen.findByText(/«@»/)).toBeInTheDocument();
  });
});

describe("textToHtml", () => {
  it("разбирает заголовки, списки и жирный текст", () => {
    const html = textToHtml("## Заголовок\n- раз\n- два\n\n**жирно**");
    expect(html).toContain("<h2>Заголовок</h2>");
    expect(html).toContain("<ul><li>раз</li><li>два</li></ul>");
    expect(html).toContain("<strong>жирно</strong>");
  });

  it("свободный нумерованный список (пустые строки между пунктами) — один <ol>", () => {
    const html = textToHtml("1. первый\n\n1. второй");
    expect(html).toContain("<ol><li>первый</li><li>второй</li></ol>");
    expect((html.match(/<ol>/g) || []).length).toBe(1);
  });
});
