import { describe, it, expect } from "vitest";
import { DOCUMENT_TYPES, getDocumentType } from "./document-types.js";

describe("DOCUMENT_TYPES", () => {
  it("содержит базовые типы", () => {
    const keys = DOCUMENT_TYPES.map((t) => t.key);
    expect(keys).toContain("npc");
    expect(keys).toContain("location");
    expect(keys).toContain("secret");
    expect(keys).toContain("note");
  });

  it("getDocumentType возвращает определение по ключу", () => {
    expect(getDocumentType("npc")?.label).toBeTruthy();
    expect(getDocumentType("missing")).toBeUndefined();
  });
});
