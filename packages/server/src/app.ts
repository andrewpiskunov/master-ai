import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Readable } from "node:stream";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  NewCampaignSchema,
  NewDocumentSchema,
  DOCUMENT_TYPES,
  getDocumentType,
  CompleteInputSchema,
  NewLinkSchema,
} from "@master-ai/shared";
import { z } from "zod";
import { CampaignService } from "./services/campaigns.js";
import { DocumentService } from "./services/documents.js";
import { ConversationService } from "./services/conversations.js";
import { ProposalService } from "./services/proposals.js";
import { BrainstormService } from "./services/brainstorm.js";
import { LinkService } from "./services/links.js";
import { SearchService } from "./services/search.js";
import type { LLMProvider } from "./llm/provider.js";
import { loadProvider } from "./llm/config.js";

type IdParams = { Params: { id: string } };

function buildWelcome(name: string): string {
  return [
    `Привет! Я — ваш ассистент-соавтор. Помогу собрать кампанию «${name}» и подготовить её к игре за столом.`,
    "",
    "Расскажите, что у вас уже есть в голове:",
    "- о каком приключении вы думаете, в каком сеттинге и системе;",
    "- кто герои и в какую историю они попадают в начале;",
    "- или, может, уже есть конкретный злодей, место или завязка.",
    "",
    "Можно начать с любой детали — я задам уточняющие вопросы и предложу первые документы (NPC, локации, секреты, сцены).",
  ].join("\n");
}

const DocumentPatchSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
});

export function buildApp(deps: { db: BetterSQLite3Database; llm?: LLMProvider }): FastifyInstance {
  const app = Fastify();
  app.register(cors, { origin: true });

  const llm = deps.llm ?? loadProvider();
  const campaignsSvc = new CampaignService(deps.db);
  const documentsSvc = new DocumentService(deps.db);
  const conversationsSvc = new ConversationService(deps.db);
  const proposalsSvc = new ProposalService(deps.db);
  const brainstormSvc = new BrainstormService({ llm, conversations: conversationsSvc, proposals: proposalsSvc });
  const linksSvc = new LinkService(deps.db);
  const searchSvc = new SearchService(deps.db);
  const BrainstormBodySchema = z.object({ message: z.string().min(1) });

  app.get("/api/document-types", () => DOCUMENT_TYPES);

  app.get("/api/campaigns", () => campaignsSvc.list());

  app.post("/api/campaigns", (req, reply) => {
    const parsed = NewCampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const campaign = campaignsSvc.create(parsed.data);
    // Сразу заводим беседу с приветствием — игрок попадает в готовый чат.
    const conv = conversationsSvc.getOrCreateForCampaign(campaign.id);
    conversationsSvc.addMessage(conv.id, "assistant", buildWelcome(campaign.name));
    return reply.code(201).send(campaign);
  });

  app.delete<IdParams>("/api/campaigns/:id", (req, reply) => {
    const { id } = req.params;
    if (!campaignsSvc.delete(id)) return reply.code(404).send({ error: "кампания не найдена" });
    return reply.code(204).send();
  });

  app.get<IdParams>("/api/campaigns/:id", (req, reply) => {
    const { id } = req.params;
    const campaign = campaignsSvc.get(id);
    if (!campaign) return reply.code(404).send({ error: "not found" });
    return campaign;
  });

  app.get<IdParams>("/api/campaigns/:id/documents", (req) => {
    const { id } = req.params;
    return documentsSvc.listByCampaign(id);
  });

  app.post("/api/documents", (req, reply) => {
    const parsed = NewDocumentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const typeDef = getDocumentType(parsed.data.type);
    if (!typeDef) return reply.code(400).send({ error: `unknown document type: ${parsed.data.type}` });

    const status = parsed.data.status;
    if (status != null && !typeDef.statuses.includes(status)) {
      return reply.code(400).send({ error: `invalid status "${status}" for type "${parsed.data.type}"` });
    }

    const campaign = campaignsSvc.get(parsed.data.campaignId);
    if (!campaign) return reply.code(404).send({ error: "campaign not found" });

    return reply.code(201).send(documentsSvc.create(parsed.data));
  });

  app.get<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    return doc;
  });

  app.patch<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    const parsed = DocumentPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const status = parsed.data.status;
    if (status != null) {
      const existing = documentsSvc.get(id);
      if (existing) {
        const typeDef = getDocumentType(existing.type);
        if (typeDef && !typeDef.statuses.includes(status)) {
          return reply.code(400).send({ error: `invalid status "${status}" for type "${existing.type}"` });
        }
      }
    }

    const updated = documentsSvc.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.get("/api/campaigns/:id/search", (req) => {
    const { id } = req.params as { id: string };
    const { q } = req.query as { q?: string };
    return searchSvc.search(id, q ?? "");
  });

  app.post("/api/campaigns/:id/links", (req, reply) => {
    const parsed = NewLinkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(linksSvc.create(parsed.data));
  });

  app.get<IdParams>("/api/documents/:id/links", (req) => {
    const { id } = req.params;
    return linksSvc.listForDocument(id);
  });

  app.delete<IdParams>("/api/links/:id", (req, reply) => {
    const { id } = req.params;
    if (!linksSvc.delete(id)) return reply.code(404).send({ error: "связь не найдена" });
    return reply.code(204).send();
  });

  app.post("/api/campaigns/:id/brainstorm", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = BrainstormBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return brainstormSvc.respond(id, parsed.data.message);
  });

  app.get("/api/campaigns/:id/proposals", (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: "pending" | "approved" | "rejected" };
    return proposalsSvc.listByCampaign(id, status);
  });

  app.get("/api/campaigns/:id/conversation", (req) => {
    const { id } = req.params as { id: string };
    const conv = conversationsSvc.getOrCreateForCampaign(id);
    return conversationsSvc.listMessages(conv.id);
  });

  app.post("/api/proposals/:id/approve", (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = proposalsSvc.approve(id, documentsSvc);
    if (!doc) return reply.code(409).send({ error: "предложение не найдено или уже обработано" });
    return doc;
  });

  app.post("/api/proposals/:id/reject", (req, reply) => {
    const { id } = req.params as { id: string };
    const p = proposalsSvc.reject(id);
    if (!p) return reply.code(404).send({ error: "предложение не найдено" });
    return p;
  });

  app.post("/api/llm/complete", (req, reply) => {
    const parsed = CompleteInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    reply.type("text/plain; charset=utf-8");
    return Readable.from(llm.complete(parsed.data));
  });

  return app;
}
