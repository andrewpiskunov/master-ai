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
      createdAt: "2026-06-29T00:00:00.000Z",
    };
    expect(CampaignSchema.parse(value)).toEqual(value);
  });

  it("NewCampaignSchema требует только name", () => {
    expect(NewCampaignSchema.parse({ name: "X" })).toEqual({ name: "X" });
  });

  it("NewCampaignSchema отвергает пустой объект", () => {
    expect(() => NewCampaignSchema.parse({})).toThrow();
  });
});
