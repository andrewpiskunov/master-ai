import type { FastifyInstance } from "fastify";
import { extractLogBlock, fallbackLogTitle, ImageIdsSchema, stripChoicePrompts, stripLogFence, type MessageMeta } from "@master-ai/shared";
import { z } from "zod";
import { AssistantJobService } from "../services/assistant-jobs.js";
import type { RouteDependencies, IdParams } from "./dependencies.js";

const MessageMetaSchema = z.object({
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  actorKind: z.enum(["pc", "npc", "master"]).optional(),
});
const AssistantStartSchema = z.object({
  message: z.string(),
  imageIds: ImageIdsSchema.optional(),
  system: z.string().optional(),
  // Игровой чат режима игры: история префиксуется актором, ответ получает мету лога.
  mode: z.literal("game").optional(),
  meta: MessageMetaSchema.optional(),
}).refine((body) => body.message.trim().length > 0 || (body.imageIds?.length ?? 0) > 0, { message: "Напишите сообщение или прикрепите изображение" });

export function registerAssistantRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "documentsSvc" | "conversationsSvc" | "llmFor" | "trackUsage" | "mediaSvc">): void {
  const { documentsSvc, conversationsSvc, llmFor, trackUsage, mediaSvc } = deps;
  const assistantJobs = new AssistantJobService();
  app.addHook("onClose", () => assistantJobs.stopAll());

  // Генерация помощника документа выполняется на сервере фоновой задачей —
  // навигация или закрытие вкладки её не прерывают. Клиент опрашивает статус.
  app.post<IdParams>("/api/documents/:id/assistant", (req, reply) => {
    const { id } = req.params;
    const parsed = AssistantStartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    if (assistantJobs.status(id).running) return reply.code(409).send({ error: "Генерация по этому документу уже идёт" });

    const images = mediaSvc.getForCampaign(doc.campaignId, parsed.data.imageIds ?? []);
    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    conversationsSvc.addMessage(conv.id, "user", parsed.data.message, { ...parsed.data.meta, ...(images.length ? { images } : {}) });
    // В LLM уходит только хвост беседы — полная история упирается в контекст модели.
    // Действия игрового чата префиксуются актором, чтобы ИИ видел, кто действует.
    // Ответы ИИ в игровом режиме уходят в историю без служебных log-блоков —
    // иначе модель имитирует паттерн «текст после log-блока» из своих прошлых ответов.
    const history = conversationsSvc.listMessages(conv.id).slice(-20).map((m) => ({
      role: m.role,
      ...(m.meta?.images?.length ? { images: mediaSvc.toLlmImages(doc.campaignId, m.meta.images) } : {}),
      content:
        m.role === "user" && m.meta?.actorName && m.meta.actorKind && m.meta.actorKind !== "master"
          ? `Действие (${m.meta.actorName}): ${m.content}`
          : m.role === "assistant" && parsed.data.mode === "game"
            ? stripChoicePrompts(stripLogFence(m.content))
            : m.content,
    }));
    // Контроллер остановки: stop() обрывает генерацию у провайдера (CLI/HTTP) сразу.
    const abort = new AbortController();
    const stream = llmFor(doc.campaignId).complete(
      { system: parsed.data.system, messages: history },
      { ...trackUsage(doc.campaignId, parsed.data.mode === "game" ? "game" : "assistant"), signal: abort.signal },
    );
    // Действие персонажа всегда порождает запись лога: из log-блока ответа,
    // а если ИИ его не вернул — с заголовком из первых слов действия.
    const isAction = parsed.data.mode === "game" && !!parsed.data.meta?.actorKind && parsed.data.meta.actorKind !== "master";
    const actionText = parsed.data.message;
    assistantJobs.start(id, stream, (text) => {
      // Пока шла генерация, документ могли удалить — не создаём «висячий» ответ.
      if (documentsSvc.get(id)) {
        let meta: MessageMeta | undefined;
        if (isAction) {
          const { log } = extractLogBlock(text);
          meta = { log: log ?? { title: fallbackLogTitle(actionText), important: false } };
        }
        conversationsSvc.addMessage(conv.id, "assistant", text, meta);
      }
    }, abort);
    return reply.code(202).send({ started: true });
  });

  app.get<IdParams>("/api/documents/:id/assistant", (req) => assistantJobs.status(req.params.id));

  app.post<IdParams>("/api/documents/:id/assistant/stop", (req, reply) => {
    if (!assistantJobs.stop(req.params.id)) return reply.code(404).send({ error: "генерация не идёт" });
    return reply.code(204).send();
  });

}
