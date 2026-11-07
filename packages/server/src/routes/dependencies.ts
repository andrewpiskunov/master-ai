import type { Database as SqliteDatabase } from "better-sqlite3";
import type { CliProviderInfo, LlmUsage } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import type { BrainstormService } from "../services/brainstorm.js";
import type { CampaignService } from "../services/campaigns.js";
import type { ConversationService } from "../services/conversations.js";
import type { DocumentService } from "../services/documents.js";
import type { LinkService } from "../services/links.js";
import type { ProposalService } from "../services/proposals.js";
import type { SearchService } from "../services/search.js";
import type { TransferService } from "../services/transfer.js";
import type { UsageService } from "../services/usage.js";
import type { MediaService } from "../services/media.js";

export type IdParams = { Params: { id: string } };

// Каждый модуль маршрутов получает через Pick только нужные ему зависимости.
export interface RouteDependencies {
  sqlite?: SqliteDatabase;
  cliProvider: CliProviderInfo;
  campaignsSvc: CampaignService;
  documentsSvc: DocumentService;
  conversationsSvc: ConversationService;
  proposalsSvc: ProposalService;
  brainstormSvc: BrainstormService;
  linksSvc: LinkService;
  searchSvc: SearchService;
  transferSvc: TransferService;
  usageSvc: UsageService;
  mediaSvc: MediaService;
  llmFor: (campaignId?: string | null) => LLMProvider;
  trackUsage: (campaignId: string | null | undefined, feature: string) => {
    onUsage: (usage: LlmUsage) => void;
  };
}
