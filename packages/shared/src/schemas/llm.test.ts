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

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=";

describe("image inputs", () => {
  it("keeps an image-only user message", () => {
    const image = { name: "map.png", dataUrl: png };
    const parsed = CompleteInputSchema.parse({ messages: [{ role: "user", content: "", images: [image] }] });
    expect(parsed.messages[0]).toHaveProperty("images", [image]);
  });

  it.each(["data:image/svg+xml;base64,PHN2Zz4=", "https://example.com/map.png", "data:image/png;base64,aGVsbG8=", "data:image/jpeg;base64,iVBORw0KGgo="])("rejects unsupported or disguised image data: %s", (dataUrl) => {
    expect(CompleteInputSchema.safeParse({ messages: [{ role: "user", content: "look", images: [{ name: "x", dataUrl }] }] }).success).toBe(false);
  });

  it("rejects more than four images in one message", () => {
    expect(CompleteInputSchema.safeParse({ messages: [{ role: "user", content: "look", images: Array.from({ length: 5 }, () => ({ name: "x.png", dataUrl: png })) }] }).success).toBe(false);
  });
});
