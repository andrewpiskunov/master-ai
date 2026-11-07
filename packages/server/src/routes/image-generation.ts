import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ImageAttachment, LlmImage } from "@master-ai/shared";
import type { ImageGenerator } from "../llm/image-generation.js";
import type { DocumentService } from "../services/documents.js";
import { ImageGenerationJobService } from "../services/image-generation-jobs.js";
import { proseMirrorToText } from "../services/prosemirror-text.js";
import type { IdParams } from "./dependencies.js";

const StartSchema = z.object({ prompt: z.string().trim().min(1).max(10_000) });

export interface ImageGenerationRouteDependencies {
  documentsSvc: Pick<DocumentService, "get">;
  mediaSvc: {
    create(campaignId: string, image: LlmImage): ImageAttachment;
    attach(documentId: string, imageId: string): ImageAttachment[];
  };
  imageGenerator: ImageGenerator;
  imageJobs?: ImageGenerationJobService;
}

export function registerImageGenerationRoutes(app: FastifyInstance, deps: ImageGenerationRouteDependencies): void {
  const { documentsSvc, mediaSvc, imageGenerator } = deps;
  const jobs = deps.imageJobs ?? new ImageGenerationJobService();
  app.addHook("onClose", () => jobs.stopAll());

  app.post<IdParams>("/api/documents/:id/image-generation", (request, reply) => {
    const document = documentsSvc.get(request.params.id);
    if (!document) return reply.code(404).send({ error: "Документ не найден" });
    const parsed = StartSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Опишите изображение: от 1 до 10 000 символов" });
    const started = jobs.start(
      document.id,
      (signal) => imageGenerator.generate({
        document: { title: document.title, type: document.type, text: proseMirrorToText(document.contentJson) },
        prompt: parsed.data.prompt,
      }, { signal }),
      (image) => {
        // Navigation does not cancel a job; deleting its entity must prevent any
        // orphan media from being created when the generator eventually returns.
        if (documentsSvc.get(document.id)?.campaignId !== document.campaignId) return undefined;
        const stored = mediaSvc.create(document.campaignId, image);
        mediaSvc.attach(document.id, stored.id);
        return stored;
      },
    );
    if (!started) return reply.code(409).send({ error: "Генерация изображения по этому документу уже идёт" });
    return reply.code(202).send({ started: true });
  });

  app.get<IdParams>("/api/documents/:id/image-generation", (request, reply) => {
    if (!documentsSvc.get(request.params.id)) return reply.code(404).send({ error: "Документ не найден" });
    return jobs.status(request.params.id);
  });

  app.post<IdParams>("/api/documents/:id/image-generation/stop", (request, reply) => {
    if (!documentsSvc.get(request.params.id)) return reply.code(404).send({ error: "Документ не найден" });
    jobs.stop(request.params.id);
    return reply.code(204).send();
  });
}
