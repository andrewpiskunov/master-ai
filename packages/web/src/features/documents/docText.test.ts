import { describe, it, expect } from "vitest";
import { docText } from "./docText.js";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("docText", () => {
  it("извлекает текст и кеширует по id+updatedAt", () => {
    const d = { id: "d1", updatedAt: "t1", contentJson: doc("привет") };
    expect(docText(d)).toContain("привет");
    // тот же updatedAt — отдаётся кеш, даже если contentJson подменили
    expect(docText({ ...d, contentJson: doc("другое") })).toContain("привет");
    // новый updatedAt — пересчёт
    expect(docText({ ...d, updatedAt: "t2", contentJson: doc("другое") })).toContain("другое");
  });
});
