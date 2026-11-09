import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ImageIdsSchema } from "@master-ai/shared";
import type { RouteDependencies, IdParams } from "./dependencies.js";

const NewMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string(), imageIds: ImageIdsSchema.optional() })
  .refine((body) => body.content.trim().length > 0 || (body.imageIds?.length ?? 0) > 0, { message: "Напишите сообщение или прикрепите изображение" });
const MessageMetaPatchSchema = z.object({
  log: z.object({ title: z.string().min(1), important: z.boolean() }).optional(),
});

export function registerConversationRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "documentsSvc" | "conversationsSvc" | "mediaSvc">): void {
  const { documentsSvc, conversationsSvc, mediaSvc } = deps;
  app.get("/api/campaigns/:id/conversation", (req) => {
    const { id } = req.params as { id: string };
    const conv = conversationsSvc.getOrCreateForCampaign(id);
    return conversationsSvc.listMessages(conv.id);
  });

  app.get<IdParams>("/api/documents/:id/conversation", (req, reply) => {
    const { id } = req.params;
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    return conversationsSvc.listMessages(conv.id);
  });

  // Очистка беседы ассистента документа («Очистить беседу» в помощнике).
  app.delete<IdParams>("/api/documents/:id/conversation", (req, reply) => {
    const { id } = req.params;
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    conversationsSvc.clearForDocument(id);
    return reply.code(204).send();
  });

  app.post<IdParams>("/api/documents/:id/conversation/messages", (req, reply) => {
    const { id } = req.params;
    const parsed = NewMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    const images = mediaSvc.getForCampaign(doc.campaignId, parsed.data.imageIds ?? []);
    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    return reply.code(201).send(conversationsSvc.addMessage(conv.id, parsed.data.role, parsed.data.content, images.length ? { images } : undefined));
  });

  // Точечное обновление меты сообщения — переключение важности записи лога в режиме игры.
  app.patch("/api/messages/:id/meta", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = MessageMetaPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updated = conversationsSvc.updateMessageMeta(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "сообщение не найдено" });
    return updated;
  });

}
