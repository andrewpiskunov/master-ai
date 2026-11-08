import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ImageIdsSchema, WorkshopImageRequestsSchema } from "@master-ai/shared";
import { AssistantJobService } from "../services/assistant-jobs.js";
import { textToDoc } from "../services/proposals.js";
import type { RouteDependencies, IdParams } from "./dependencies.js";

const BrainstormBodySchema = z.object({ message: z.string(), imageIds: ImageIdsSchema.optional() })
  .refine((body) => body.message.trim().length > 0 || (body.imageIds?.length ?? 0) > 0, { message: "Напишите сообщение или прикрепите изображение" });

export function registerWorkshopRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "campaignsSvc" | "documentsSvc" | "brainstormSvc" | "mediaSvc" | "workshopImagesSvc" | "conversationsSvc">): void {
  const { campaignsSvc, documentsSvc, brainstormSvc, mediaSvc, workshopImagesSvc, conversationsSvc } = deps;
  const workshopJobs = new AssistantJobService(); // фоновые генерации мастерской (ключ — id кампании)
  const synchronousJobs = new Set<string>();
  const generating = (id: string) => workshopJobs.status(id).running || synchronousJobs.has(id);
  app.addHook("onClose", () => workshopJobs.stopAll());

  app.post("/api/campaigns/:id/brainstorm", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = BrainstormBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (!campaignsSvc.get(id)) return reply.code(404).send({ error: "кампания не найдена" });
    if (generating(id)) return reply.code(409).send({ error: "Генерация мастерской уже идёт" });
    const images = mediaSvc.getForCampaign(id, parsed.data.imageIds ?? []);
    synchronousJobs.add(id);
    try { return await brainstormSvc.respond(id, parsed.data.message, images); }
    finally { synchronousJobs.delete(id); }
  });

  // Генерация мастерской фоновой задачей на сервере (как у помощника документа):
  // навигация и закрытие вкладки её не прерывают, клиент опрашивает статус.
  app.post("/api/campaigns/:id/brainstorm/start", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = BrainstormBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (!campaignsSvc.get(id)) return reply.code(404).send({ error: "кампания не найдена" });
    if (generating(id)) return reply.code(409).send({ error: "Генерация мастерской уже идёт" });
    const images = mediaSvc.getForCampaign(id, parsed.data.imageIds ?? []);
    const abort = new AbortController();
    const { conversationId, stream } = brainstormSvc.prepareRespond(id, parsed.data.message, abort.signal, images);
    workshopJobs.start(id, stream, async (full) => {
      // Пока шла генерация, кампанию могли удалить — не создаём «висячие» записи.
      if (campaignsSvc.get(id)) await brainstormSvc.finishRespond(id, conversationId, full, abort.signal);
    }, abort);
    return reply.code(202).send({ started: true });
  });

  app.get("/api/campaigns/:id/brainstorm/status", (req) => workshopJobs.status((req.params as { id: string }).id));

  app.post("/api/campaigns/:id/brainstorm/new-topic", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!campaignsSvc.get(id)) return reply.code(404).send({ error: "Кампания не найдена" });
    if (generating(id)) return reply.code(409).send({ error: "Дождитесь завершения генерации мастерской" });
    const conv = conversationsSvc.getOrCreateForCampaign(id);
    return reply.code(201).send(conversationsSvc.addMessage(conv.id, "assistant", "", { workshopTopicStart: true }));
  });

  app.post("/api/campaigns/:id/image-attachments", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!campaignsSvc.get(id)) return reply.code(404).send({ error: "Кампания не найдена" });
    const parsed = z.object({ attachments: WorkshopImageRequestsSchema, messageId: z.string().uuid().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Укажите от 1 до 50 изображений и целевые карточки" });
    const conv = parsed.data.messageId ? conversationsSvc.getOrCreateForCampaign(id) : undefined;
    const message = conv && conversationsSvc.listMessages(conv.id).find((m) => m.id === parsed.data.messageId && m.role === "assistant");
    if (parsed.data.messageId && !message) return reply.code(404).send({ error: "Сообщение мастерской не найдено" });
    const results = await workshopImagesSvc.attach(id, parsed.data.attachments);
    if (message) conversationsSvc.updateMessageMeta(message.id, { imageAttachments: results });
    return { results };
  });

  // Остановка генерации мастерской: сигнал обрывает CLI/HTTP, набранный текст сохраняется.
  app.post("/api/campaigns/:id/brainstorm/stop", (req, reply) => {
    if (!workshopJobs.stop((req.params as { id: string }).id)) return reply.code(404).send({ error: "генерация не идёт" });
    return reply.code(204).send();
  });

  app.get("/api/campaigns/:id/world", async (req) => {
    const { id } = req.params as { id: string };
    return brainstormSvc.worldSummary(id);
  });

  app.get("/api/campaigns/:id/consistency", async (req) => {
    const { id } = req.params as { id: string };
    return brainstormSvc.checkConsistency(id);
  });

  // Завершить сессию и создать следующую: сводка ИИ → новая сессия с заполненным
  // «Что было в прошлый раз» и заделом на планируемые моменты.
  app.post<IdParams>("/api/documents/:id/next-session", async (req, reply) => {
    const { id } = req.params;
    const sess = documentsSvc.get(id);
    if (!sess) return reply.code(404).send({ error: "документ не найден" });
    if (sess.type !== "session") return reply.code(400).send({ error: "документ не является сессией" });

    // Идемпотентность: если следующая сессия уже создана — вернуть её.
    const existingNext = typeof sess.fields?.nextSessionId === "string" ? sess.fields.nextSessionId : null;
    if (existingNext) {
      const existing = documentsSvc.get(existingNext);
      if (existing) return existing;
    }

    const { summary, seed } = await brainstormSvc.sessionSummary(id);
    // Номер следующей сессии — максимум по всем сессиям кампании: поле sessionNumber,
    // а для сессий без него (созданных ИИ/вручную) — число из названия «Сессия N…».
    const sessionNum = (d: { title: string; fields?: Record<string, unknown> }): number => {
      if (typeof d.fields?.sessionNumber === "number") return d.fields.sessionNumber;
      const m = /^сессия\s+(\d+)/i.exec(d.title.trim());
      return m ? Number(m[1]) : 0;
    };
    const sessions = documentsSvc.listByCampaign(sess.campaignId).filter((d) => d.type === "session");
    // Сессии без номера (авторские названия вроде «Испытание Шпигельгрунда») дают 0 —
    // страхуемся количеством сессий, чтобы следующая после такой не стала «Сессией 1».
    const nextNum = Math.max(sessions.length, ...sessions.map(sessionNum)) + 1;
    const md = [
      "## Цель сессии", "",
      "## Что было в прошлый раз", summary || "",
      "## Запланированные моменты", seed || "",
      "## NPC и локации", "",
      "## Заметки и что доделать", "",
    ].join("\n");

    const created = documentsSvc.create({
      campaignId: sess.campaignId,
      type: "session",
      title: `Сессия ${nextNum}`,
      contentJson: textToDoc(md),
      fields: { sessionNumber: nextNum, prevSessionId: id },
    });
    // Помечаем текущую сыгранной, сохраняем сводку и связь на следующую.
    documentsSvc.update(id, { status: "played", fields: { ...sess.fields, summary, nextSessionId: created.id } });
    return reply.code(201).send(created);
  });

}
