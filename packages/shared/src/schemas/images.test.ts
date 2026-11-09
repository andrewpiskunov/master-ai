import { describe, expect, it } from "vitest";
import { WorkshopImageAttachmentResultSchema, WorkshopImageRequestSchema } from "./images.js";

const documentId = "969abf0a-92c5-4428-9432-94a41594dc21";
const imageId = "969abf0a-92c5-4428-9432-94a41594dc22";

describe("assistant image actions", () => {
  it("accepts a trimmed generation prompt and an explicit avatar request", () => {
    expect(WorkshopImageRequestSchema.parse({ documentId, prompt: "  Портрет смотрителя  ", setAsAvatar: true }))
      .toEqual({ documentId, prompt: "Портрет смотрителя", setAsAvatar: true });
  });

  it("requires exactly one bounded source for each action", () => {
    for (const source of [{}, { prompt: " " }, { prompt: "x".repeat(10_001) }, { prompt: "портрет", path: "/portrait.png" }, { prompt: "портрет", imageId }, { path: "/portrait.png", imageId }]) {
      expect(WorkshopImageRequestSchema.safeParse({ documentId, ...source }).success).toBe(false);
    }
    expect(WorkshopImageRequestSchema.safeParse({ documentId, prompt: "x".repeat(10_000) }).success).toBe(true);
  });

  it("retains the confirmed avatar assignment in stored result metadata", () => {
    expect(WorkshopImageAttachmentResultSchema.parse({ documentId, documentTitle: "Смотритель", isAvatar: true }))
      .toEqual({ documentId, documentTitle: "Смотритель", isAvatar: true });
  });

  it("accepts at most four reference images only with a generation or edit prompt", () => {
    expect(WorkshopImageRequestSchema.parse({ documentId, prompt: "Убери надпись", referenceImageIds: [imageId] }))
      .toEqual({ documentId, prompt: "Убери надпись", referenceImageIds: [imageId] });
    for (const value of [
      { imageId, referenceImageIds: [imageId] },
      { path: "/generated.png", referenceImageIds: [imageId] },
      { prompt: "Правка", referenceImageIds: ["../private"] },
      { prompt: "Правка", referenceImageIds: Array(5).fill(imageId) },
    ]) expect(WorkshopImageRequestSchema.safeParse({ documentId, ...value }).success).toBe(false);
  });
});
