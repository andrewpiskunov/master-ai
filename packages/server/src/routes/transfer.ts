import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./dependencies.js";

export function registerTransferRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "sqlite" | "transferSvc">): void {
  const { sqlite, transferSvc } = deps;
  // Резервная копия базы одним файлом — «скачать бэкап» из управления кампанией.
  app.get("/api/backup", (_req, reply) => {
    if (!sqlite) return reply.code(503).send({ error: "Бэкап недоступен" });
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-disposition", `attachment; filename="master-ai-${stamp}.sqlite"`)
      .type("application/octet-stream")
      .send(sqlite.serialize());
  });

  // Полный экспорт кампании одним JSON-файлом (документы, беседы, предложения, связи, статистика).
  app.get("/api/campaigns/:id/export-json", (req, reply) => {
    const { id } = req.params as { id: string };
    const data = transferSvc.export(id);
    if (!data) return reply.code(404).send({ error: "кампания не найдена" });
    const slug = data.campaign.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "campaign";
    reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${slug}.master-ai.json`)}`);
    reply.type("application/json; charset=utf-8");
    return reply.send(JSON.stringify(data, null, 2));
  });

  // Импорт кампании из такого же JSON — создаёт НОВУЮ кампанию, id перевязываются.
  app.post("/api/campaigns/import-json", { bodyLimit: 64 * 1024 * 1024 }, (req, reply) => {
    try {
      const created = transferSvc.import(req.body);
      return reply.code(201).send(created);
    } catch {
      return reply.code(400).send({ error: "Файл не похож на экспорт кампании MasterAI (master-ai-campaign, версия 1)" });
    }
  });

}
