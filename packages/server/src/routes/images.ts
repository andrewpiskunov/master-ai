import type { FastifyInstance } from "fastify";
import { ImageUploadSchema } from "@master-ai/shared";
import { z } from "zod";
import { imageEtag, MediaError, type ThumbnailSize } from "../services/media.js";
import type { IdParams, RouteDependencies } from "./dependencies.js";

const thumbnailQuery = z.object({ size: z.enum(["128", "256", "512", "1024"]).default("256") });
const matchesEtag = (header: string | undefined, etag: string): boolean =>
  header?.split(",").some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag) ?? false;

export function registerImageRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "mediaSvc" | "documentsSvc" | "campaignsSvc">): void {
  const { mediaSvc, documentsSvc, campaignsSvc } = deps;
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

  app.get<IdParams>("/api/campaigns/:id/images", (req) => mediaSvc.listForCampaign(req.params.id));
  app.put<IdParams>("/api/campaigns/:id/cover", (req, reply) => {
    const parsed = z.object({ imageId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    mediaSvc.setCampaignCover(req.params.id, parsed.data.imageId);
    return campaignsSvc.get(req.params.id);
  });

  app.get<IdParams & { Querystring: { size?: string } }>("/api/images/:id/thumbnail", async (req, reply) => {
    const parsed = thumbnailQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "Размер миниатюры должен быть 128, 256, 512 или 1024" });
    const thumbnail = await mediaSvc.getThumbnail(req.params.id, Number(parsed.data.size) as ThumbnailSize);
    if (!thumbnail) return reply.code(404).send({ error: "изображение не найдено" });
    reply.type("image/webp").header("x-content-type-options", "nosniff")
      .header("cache-control", "private, max-age=86400").header("etag", thumbnail.etag);
    if (matchesEtag(req.headers["if-none-match"], thumbnail.etag)) return reply.code(304).send();
    return reply.send(thumbnail.data);
  });

  app.get<IdParams>("/api/images/:id", (req, reply) => {
    const row = mediaSvc.get(req.params.id);
    if (!row) return reply.code(404).send({ error: "изображение не найдено" });
    const data = Buffer.from(row.dataUrl.slice(row.dataUrl.indexOf(",") + 1), "base64");
    const etag = imageEtag(data);
    reply.type(row.mimeType).header("x-content-type-options", "nosniff")
      .header("cache-control", "private, max-age=86400").header("etag", etag);
    if (matchesEtag(req.headers["if-none-match"], etag)) return reply.code(304).send();
    return reply.send(data);
  });

  app.get<IdParams>("/api/documents/:id/images", (req) => mediaSvc.listForDocument(req.params.id));
  app.put<IdParams>("/api/documents/:id/avatar", (req, reply) => {
    const parsed = z.object({ imageId: z.string().uuid().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    mediaSvc.setAvatar(req.params.id, parsed.data.imageId);
    return documentsSvc.get(req.params.id);
  });
  app.post<IdParams>("/api/documents/:id/images", (req, reply) => {
    const parsed = z.object({ imageId: z.string().uuid() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return mediaSvc.attach(req.params.id, parsed.data.imageId);
  });
  app.delete<{ Params: { id: string; imageId: string } }>("/api/documents/:id/images/:imageId", (req) => mediaSvc.detach(req.params.id, req.params.imageId));
}
