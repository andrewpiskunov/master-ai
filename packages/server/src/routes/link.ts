import type { FastifyInstance } from "fastify";
import { NewLinkSchema } from "@master-ai/shared";
import type { RouteDependencies, IdParams } from "./dependencies.js";

export function registerLinkRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "searchSvc" | "linksSvc">): void {
  const { searchSvc, linksSvc } = deps;
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

}
