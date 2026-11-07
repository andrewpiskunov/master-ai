import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";

const attributes = [
  "| Группа | Атрибуты |",
  "|---|---|",
  "| Физические | **Сила**, Ловкость, Выносливость |",
  "| Социальные | Харизма, Манипулирование, Выдержка |",
  "| Ментальные | Интеллект, Смекалка, Решимость |",
].join("\n");

function renderMarkdown(text: string) {
  return render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Markdown>{text}</Markdown></MemoryRouter>);
}

describe("Markdown tables in AI replies", () => {
  it("renders saved pipe-delimited tables with headers, rows and inline formatting", () => {
    renderMarkdown(`Названия атрибутов:\n\n${attributes}\n\nПродолжаем подготовку.`);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Группа", "Атрибуты"]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("cell", { name: "Физические" })).toBeInTheDocument();
    expect(within(table).getByText("Сила").tagName).toBe("STRONG");
    expect(screen.getByText("Продолжаем подготовку.")).toBeInTheDocument();
  });

  it("wraps each table in a focusable scroll region for narrow chat panels", () => {
    renderMarkdown(attributes);
    const region = screen.getByRole("region", { name: "Таблица" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });

  it("keeps alignment, escaped pipes and entity mentions inside cells", () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Markdown mentions={[{ title: "Старый маяк", type: "location", href: "/campaigns/demo/documents/lighthouse" }]}>{[
        "| Место | Запись | Сложность |", "| :--- | :---: | ---: |",
        "| Старый маяк | `A` \\| **B** | 12 |",
      ].join("\n")}</Markdown>
    </MemoryRouter>);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Старый маяк" })).toHaveAttribute("href", "/campaigns/demo/documents/lighthouse");
    expect(within(table).getByRole("cell", { name: "A | B" })).toHaveStyle({ textAlign: "center" });
    expect(within(table).getByRole("cell", { name: "12" })).toHaveStyle({ textAlign: "right" });
  });

  it("does not turn fenced code containing table syntax into a table", () => {
    renderMarkdown(`\`\`\`text\n${attributes}\n\`\`\``);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/\| Группа \| Атрибуты \|/).tagName).toBe("CODE");
  });

  it("does not execute HTML inside cells", () => {
    const { container } = renderMarkdown("| Поле | Значение |\n|---|---|\n| Пример | <script>alert(1)</script> |\n");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
