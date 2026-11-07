import type { FastifyInstance } from "fastify";
import { ImageUploadSchema } from "@master-ai/shared";
import { z } from "zod";
import { MediaError } from "../services/media.js";
import type { IdParams, RouteDependencies } from "./dependencies.js";

export function registerImageRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "mediaSvc">): void {
  const { mediaSvc } = deps;
  // Такой же формат ошибок используется всеми клиентами, включая чаты с imageIds.
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof MediaError) return reply.code(error.statusCode).send({ error: error.message });
    return reply.send(error);
  });
  app.post<IdParams>("/api/campaigns/:id/images", { bodyLimit: 15 * 1024 * 1024 }, (req, reply) => {
    const parsed = ImageUploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(mediaSvc.create(req.params.id, parsed.data));
  });

  app.get<IdParams>("/api/images/:id", (req, reply) => {
    const row = mediaSvc.get(req.params.id);
    if (!row) return reply.code(404).send({ error: "изображение не найдено" });
    return reply.type(row.mimeType).header("x-content-type-options", "nosniff")
      .send(Buffer.from(row.dataUrl.slice(row.dataUrl.indexOf(",") + 1), "base64"));
  });

  app.get<IdParams>("/api/documents/:id/images", (req) => mediaSvc.listForDocument(req.params.id));
  app.post<IdParams>("/api/documents/:id/images", (req, reply) => {
    const parsed = z.object({ imageId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return mediaSvc.attach(req.params.id, parsed.data.imageId);
  });
  app.delete<{ Params: { id: string; imageId: string } }>("/api/documents/:id/images/:imageId", (req) => mediaSvc.detach(req.params.id, req.params.imageId));
}
