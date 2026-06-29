import { describe, it, expect } from "vitest";
import { CompleteInputSchema } from "./llm.js";

describe("CompleteInputSchema", () => {
  it("принимает валидный ввод", () => {
    const value = { system: "ты гейм-мастер", messages: [{ role: "user", content: "привет" }] };
    expect(CompleteInputSchema.parse(value)).toEqual(value);
  });

  it("требует непустой messages", () => {
    expect(() => CompleteInputSchema.parse({ messages: [] })).toThrow();
  });

  it("отвергает неизвестную роль", () => {
    expect(() => CompleteInputSchema.parse({ messages: [{ role: "boss", content: "x" }] })).toThrow();
  });
});
