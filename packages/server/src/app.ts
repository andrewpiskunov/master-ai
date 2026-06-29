import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  NewCampaignSchema,
  NewDocumentSchema,
  DOCUMENT_TYPES,
  getDocumentType,
} from "@master-ai/shared";
import { z } from "zod";
import { CampaignService } from "./services/campaigns.js";
import { DocumentService } from "./services/documents.js";

type IdParams = { Params: { id: string } };

const DocumentPatchSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
});

export function buildApp(deps: { db: BetterSQLite3Database }): FastifyInstance {
  const app = Fastify();
  app.register(cors, { origin: true });

  const campaignsSvc = new CampaignService(deps.db);
  const documentsSvc = new DocumentService(deps.db);

  app.get("/api/document-types", () => DOCUMENT_TYPES);

  app.get("/api/campaigns", () => campaignsSvc.list());

  app.post("/api/campaigns", (req, reply) => {
    const parsed = NewCampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(campaignsSvc.create(parsed.data));
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

  return app;
}
