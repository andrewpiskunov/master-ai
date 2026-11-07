import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_IMAGE_BYTES, type LlmImage, type WorkshopImageAttachmentResult, type WorkshopImageRequest } from "@master-ai/shared";
import type { DocumentService } from "./documents.js";
import { MediaError, type MediaService } from "./media.js";

export class WorkshopImageService {
  constructor(
    private documents: DocumentService,
    private media: MediaService,
    private generatedImagesDir = process.env.MASTER_AI_GENERATED_IMAGES_DIR ?? join(homedir(), ".codex", "generated_images"),
  ) {}

  private async readGenerated(path: string): Promise<LlmImage> {
    try {
      const requested = path.startsWith("file:") ? fileURLToPath(path) : path;
      if (!isAbsolute(requested)) throw new MediaError("Нужен абсолютный путь к изображению Codex");
      const root = await realpath(this.generatedImagesDir);
      const actual = await realpath(requested);
      const inside = relative(root, actual);
      if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
        throw new MediaError("Разрешены только изображения из каталога генерации Codex");
      }
      const expected = await lstat(actual);
      if (!expected.isFile() || expected.size === 0 || expected.size > MAX_IMAGE_BYTES) throw new MediaError("Нужен файл изображения размером до 10 МиБ");
      // O_NONBLOCK не даёт зависнуть на FIFO даже при подмене файла после lstat.
      const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) throw new MediaError("Нужен файл изображения размером до 10 МиБ");
        if (stat.dev !== expected.dev || stat.ino !== expected.ino || await realpath(actual) !== actual || await realpath(root) !== root) {
          throw new MediaError("Путь изображения изменился; повторите прикрепление");
        }
        // Ограничиваем чтение и при изменении файла после stat.
        const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_IMAGE_BYTES + 1));
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length !== stat.size) throw new MediaError("Файл изображения изменился; повторите прикрепление");
        const bytes = buffer.subarray(0, length);
        const mimeType = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
            : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
        if (!mimeType) throw new MediaError("Файл не является изображением PNG, JPEG или WebP");
        return { name: basename(actual).slice(0, 200), dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError("Не удалось прочитать изображение из каталога Codex. Проверьте, что файл существует.");
    }
  }

  async attach(campaignId: string, requests: WorkshopImageRequest[], signal?: AbortSignal): Promise<WorkshopImageAttachmentResult[]> {
    const results: WorkshopImageAttachmentResult[] = [];
    for (const request of requests) {
      const result: WorkshopImageAttachmentResult = { documentId: request.documentId, documentTitle: "" };
      try {
        if (signal?.aborted) throw new MediaError("Прикрепление изображения остановлено");
        const doc = this.documents.get(request.documentId);
        if (!doc || doc.campaignId !== campaignId) throw new MediaError("Карточка не найдена в этой кампании");
        result.documentTitle = doc.title;
        if (request.imageId) {
          const image = this.media.getForCampaign(campaignId, [request.imageId])[0];
          result.image = this.media.attach(doc.id, image.id).find((attached) => attached.id === image.id);
        } else {
          const image = await this.readGenerated(request.path!);
          if (signal?.aborted) throw new MediaError("Прикрепление изображения остановлено");
          if (this.documents.get(doc.id)?.campaignId !== campaignId) throw new MediaError("Карточка больше не существует в этой кампании");
          result.image = this.media.importForDocument(doc.id, image);
        }
      } catch (error) {
        result.error = error instanceof MediaError ? error.message : "Не удалось прикрепить изображение";
      }
      results.push(result);
    }
    return results;
  }
}
