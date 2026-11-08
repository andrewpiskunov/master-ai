import type { FastifyInstance } from "fastify";
import { DOCUMENT_TYPES, NewDocumentSchema, getDocumentType } from "@master-ai/shared";
import { z } from "zod";
import { DocumentConflictError } from "../services/documents.js";
import type { RouteDependencies, IdParams } from "./dependencies.js";

const DocumentPatchSchema = z.object({
  type: z.string().optional(),
  title: z.string().min(1).optional(),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
  expectedUpdatedAt: z.string().optional(),
});


export function registerDocumentRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "campaignsSvc" | "documentsSvc">): void {
  const { campaignsSvc, documentsSvc } = deps;
  app.get("/api/document-types", () => DOCUMENT_TYPES);

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

  app.delete<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    if (!documentsSvc.delete(id)) return reply.code(404).send({ error: "документ не найден" });
    return reply.code(204).send();
  });

  app.patch<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    const parsed = DocumentPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const existing = documentsSvc.get(id);
    if (!existing) return reply.code(404).send({ error: "not found" });

    // Новый тип (если меняется) должен быть известным.
    if (parsed.data.type != null && !getDocumentType(parsed.data.type)) {
      return reply.code(400).send({ error: `unknown document type: ${parsed.data.type}` });
    }
    const effectiveType = parsed.data.type ?? existing.type;
    const typeDef = getDocumentType(effectiveType);

    const { expectedUpdatedAt, ...patch } = parsed.data;
    if (patch.status != null) {
      if (typeDef && !typeDef.statuses.includes(patch.status)) {
        return reply.code(400).send({ error: `invalid status "${patch.status}" for type "${effectiveType}"` });
      }
    } else if (parsed.data.type != null && existing.status != null && typeDef && !typeDef.statuses.includes(existing.status)) {
      // Тип сменился, а прежний статус не подходит новому типу — сбрасываем.
      patch.status = null;
    }

    try {
      const updated = documentsSvc.update(id, patch, expectedUpdatedAt);
      if (!updated) return reply.code(404).send({ error: "not found" });
      return updated;
    } catch (error) {
      if (error instanceof DocumentConflictError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

}
