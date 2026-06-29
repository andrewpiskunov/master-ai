import { describe, it, expect } from "vitest";
import { FakeProvider } from "./fake.js";

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const c of iter) out += c;
  return out;
}

describe("FakeProvider", () => {
  it("отдаёт заданные чанки по очереди", async () => {
    const provider = new FakeProvider(["Привет", ", ", "мир"]);
    const result = await collect(provider.complete({ messages: [{ role: "user", content: "x" }] }));
    expect(result).toBe("Привет, мир");
  });
});
