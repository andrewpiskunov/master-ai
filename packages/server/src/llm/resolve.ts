import type { Campaign } from "@master-ai/shared";
import type { LLMProvider } from "./provider.js";
import { OpenAIProvider } from "./openai.js";

// Нейросеть кампании: openai с заполненным ключом — OpenAI-провайдер,
// иначе — провайдер по умолчанию (Claude Code CLI).
export function providerForCampaign(campaign: Campaign | undefined, fallback: LLMProvider): LLMProvider {
  if (campaign?.llmProvider === "openai" && campaign.llmSettings?.apiKey?.trim()) {
    return new OpenAIProvider({
      apiKey: campaign.llmSettings.apiKey.trim(),
      model: campaign.llmSettings.model,
      baseUrl: campaign.llmSettings.baseUrl,
    });
  }
  return fallback;
}
