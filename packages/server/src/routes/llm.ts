import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { CompleteInputSchema, type LlmRuntimeConfig } from "@master-ai/shared";
import type { RouteDependencies } from "./dependencies.js";

export function registerLlmRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "cliProvider" | "llmFor" | "trackUsage" | "usageSvc" | "campaignsSvc">): void {
  const { cliProvider, llmFor, trackUsage, usageSvc, campaignsSvc } = deps;
  app.get("/api/llm/config", (): LlmRuntimeConfig => ({ cli: cliProvider }));

  app.post("/api/llm/complete", { bodyLimit: 64 * 1024 * 1024 }, (req, reply) => {
    const parsed = CompleteInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    reply.type("text/plain; charset=utf-8");
    return Readable.from(llmFor(parsed.data.campaignId).complete(parsed.data, trackUsage(parsed.data.campaignId, "tools")));
  });

  app.get("/api/campaigns/:id/llm-usage", (req) => {
    const { id } = req.params as { id: string };
    return usageSvc.statsByCampaign(id);
  });

  // Итоговая статистика расхода по всему сайту (все кампании).
  app.get("/api/llm-usage", () => usageSvc.statsGlobal((id) => campaignsSvc.get(id)?.name));

}
