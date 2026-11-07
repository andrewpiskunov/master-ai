import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./dependencies.js";

export function registerProposalRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "proposalsSvc" | "documentsSvc">): void {
  const { proposalsSvc, documentsSvc } = deps;
  app.get("/api/campaigns/:id/proposals", (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: "pending" | "approved" | "rejected" };
    return proposalsSvc.listByCampaign(id, status);
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

}
