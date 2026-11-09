import { describe, it, expect } from "vitest";
import { CampaignSchema, NewCampaignSchema } from "./campaign.js";

describe("CampaignSchema", () => {
  it("принимает валидную кампанию", () => {
    const value = {
      id: "abc",
      name: "Город Солнца",
      system: "Hunter: The Vigil",
      description: null,
      realism: "balanced",
      llmProvider: "cli",
      llmSettings: { apiKey: "sk-1", model: "gpt-4o-mini" },
      createdAt: "2026-06-29T00:00:00.000Z",
    };
    expect(CampaignSchema.parse(value)).toEqual(value);
  });

  it("NewCampaignSchema требует только name", () => {
    expect(NewCampaignSchema.parse({ name: "X" })).toEqual({ name: "X" });
  });

  it("сохраняет безопасные метаданные обложки и дату активности", () => {
    const value = {
      id: "campaign", name: "Библиотека", system: null, description: null,
      realism: "balanced", llmProvider: "cli", llmSettings: {},
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
      cover: { id: "13ad6605-4bb6-4678-82b6-dcc9dca5511b", name: "Обложка.png", mimeType: "image/png" },
    };
    expect(CampaignSchema.parse(value)).toEqual(value);
    expect(CampaignSchema.parse({ ...value, cover: null }).cover).toBeNull();
    expect(CampaignSchema.safeParse({ ...value, cover: { ...value.cover, mimeType: "image/svg+xml" } }).success).toBe(false);
  });

  it("NewCampaignSchema отвергает пустой объект", () => {
    expect(() => NewCampaignSchema.parse({})).toThrow();
  });
});
