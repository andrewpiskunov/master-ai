import { describe, it, expect } from "vitest";
import { lineDiff } from "./lineDiff.js";

describe("lineDiff", () => {
  it("помечает добавленные и удалённые строки, общие оставляет", () => {
    const d = lineDiff("а\nб\nв", "а\nБ2\nв\nг");
    expect(d).toEqual([
      { type: "same", text: "а" },
      { type: "del", text: "б" },
      { type: "add", text: "Б2" },
      { type: "same", text: "в" },
      { type: "add", text: "г" },
    ]);
  });

  it("пустой исходный текст — всё добавления", () => {
    const d = lineDiff("", "строка");
    expect(d.filter((l) => l.type === "add")).toHaveLength(1);
    expect(d.some((l) => l.type === "del")).toBe(false);
  });

  it("одинаковый текст — только общие строки", () => {
    const d = lineDiff("а\nб", "а\nб");
    expect(d.every((l) => l.type === "same")).toBe(true);
  });
});
