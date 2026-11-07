import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { CampaignService } from "./services/campaigns.js";
import { DocumentService } from "./services/documents.js";
import { ConversationService } from "./services/conversations.js";
import { ProposalService } from "./services/proposals.js";
import { BrainstormService } from "./services/brainstorm.js";
import { LinkService } from "./services/links.js";
import { SearchService } from "./services/search.js";
import { UsageService } from "./services/usage.js";
import { TransferService } from "./services/transfer.js";
import type { LLMProvider } from "./llm/provider.js";
import { loadProvider } from "./llm/config.js";
import { providerForCampaign } from "./llm/resolve.js";
import type { RouteDependencies } from "./routes/dependencies.js";
import { registerCampaignRoutes } from "./routes/campaign.js";
import { registerDocumentRoutes } from "./routes/document.js";
import { registerLinkRoutes } from "./routes/link.js";
import { registerWorkshopRoutes } from "./routes/workshop.js";
import { registerConversationRoutes } from "./routes/conversation.js";
import { registerAssistantRoutes } from "./routes/assistant.js";
import { registerProposalRoutes } from "./routes/proposal.js";
import { registerLlmRoutes } from "./routes/llm.js";
import { registerTransferRoutes } from "./routes/transfer.js";

export function buildApp(deps: { db: BetterSQLite3Database; llm?: LLMProvider; sqlite?: SqliteDatabase }): FastifyInstance {
  const app = Fastify();
  app.register(cors, { origin: true });

  const llm = deps.llm ?? loadProvider();
  const campaignsSvc = new CampaignService(deps.db);
  // Нейросеть выбирается настройками кампании; без кампании — провайдер по умолчанию.
  const llmFor: RouteDependencies["llmFor"] = (campaignId) =>
    providerForCampaign(campaignId ? campaignsSvc.get(campaignId) : undefined, llm);
  const documentsSvc = new DocumentService(deps.db);
  const conversationsSvc = new ConversationService(deps.db);
  const proposalsSvc = new ProposalService(deps.db);
  const usageSvc = new UsageService(deps.db);
  // Колбэк учёта токенов; кампании без id (нет контекста) не учитываем.
  const trackUsage: RouteDependencies["trackUsage"] = (campaignId, feature) => ({
    onUsage: (u) => { if (campaignId) usageSvc.record(campaignId, feature, u); },
  });
  const brainstormSvc = new BrainstormService({ llmFor, conversations: conversationsSvc, proposals: proposalsSvc, documents: documentsSvc, campaigns: campaignsSvc, usage: usageSvc });
  const routes: RouteDependencies = {
    sqlite: deps.sqlite,
    campaignsSvc,
    documentsSvc,
    conversationsSvc,
    proposalsSvc,
    usageSvc,
    brainstormSvc,
    linksSvc: new LinkService(deps.db),
    searchSvc: new SearchService(deps.db),
    transferSvc: new TransferService(deps.db),
    llmFor,
    trackUsage,
  };

  registerCampaignRoutes(app, routes);
  registerDocumentRoutes(app, routes);
  registerLinkRoutes(app, routes);
  registerWorkshopRoutes(app, routes);
  registerConversationRoutes(app, routes);
  registerAssistantRoutes(app, routes);
  registerProposalRoutes(app, routes);
  registerLlmRoutes(app, routes);
  registerTransferRoutes(app, routes);

  return app;
}
