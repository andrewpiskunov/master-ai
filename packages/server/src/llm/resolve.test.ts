import { describe, it, expect } from "vitest";
import type { Campaign } from "@master-ai/shared";
import { providerForCampaign } from "./resolve.js";
import { OpenAIProvider } from "./openai.js";
import { FakeProvider } from "./fake.js";

const base: Campaign = {
  id: "c1", name: "К", system: null, description: null, realism: "balanced",
  llmProvider: "cli", llmSettings: {}, createdAt: "x",
};
const fallback = new FakeProvider([""]);

describe("providerForCampaign", () => {
  it("openai с ключом → OpenAIProvider", () => {
    const c = { ...base, llmProvider: "openai" as const, llmSettings: { apiKey: "sk-1" } };
    expect(providerForCampaign(c, fallback)).toBeInstanceOf(OpenAIProvider);
  });

  it("openai без ключа → провайдер по умолчанию", () => {
    const c = { ...base, llmProvider: "openai" as const, llmSettings: {} };
    expect(providerForCampaign(c, fallback)).toBe(fallback);
  });

  it("cli и неизвестная кампания → провайдер по умолчанию", () => {
    expect(providerForCampaign(base, fallback)).toBe(fallback);
    expect(providerForCampaign(undefined, fallback)).toBe(fallback);
  });
});
