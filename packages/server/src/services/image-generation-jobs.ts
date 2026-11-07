import type { ImageAttachment, LlmImage } from "@master-ai/shared";

export interface ImageGenerationJobStatus {
  running: boolean;
  error: string | null;
  image?: ImageAttachment;
}

interface Job extends ImageGenerationJobStatus {
  abort: AbortController;
  stopped: boolean;
  done?: Promise<void>;
}

const CLEANUP_MS = 60_000;

export class ImageGenerationJobService {
  private jobs = new Map<string, Job>();

  status(documentId: string): ImageGenerationJobStatus {
    const job = this.jobs.get(documentId);
    if (!job) return { running: false, error: null };
    return { running: job.running, error: job.error, ...(job.image ? { image: job.image } : {}) };
  }

  start(
    documentId: string,
    generate: (signal: AbortSignal) => Promise<LlmImage>,
    onFinish: (image: LlmImage) => ImageAttachment | undefined | Promise<ImageAttachment | undefined>,
  ): boolean {
    if (this.jobs.get(documentId)?.running) return false;
    const job: Job = { running: true, error: null, abort: new AbortController(), stopped: false };
    this.jobs.set(documentId, job);
    job.done = (async () => {
      try {
        const image = await generate(job.abort.signal);
        if (!job.stopped) job.image = await onFinish(image);
      } catch (error) {
        if (!job.stopped) job.error = error instanceof Error ? error.message : "Не удалось создать изображение";
      } finally {
        job.running = false;
        const timer = setTimeout(() => {
          if (this.jobs.get(documentId) === job) this.jobs.delete(documentId);
        }, CLEANUP_MS);
        timer.unref();
      }
    })();
    return true;
  }

  stop(documentId: string): boolean {
    const job = this.jobs.get(documentId);
    if (!job?.running) return false;
    job.stopped = true;
    job.abort.abort();
    return true;
  }

  // Fastify's close hook waits for children to exit and remove their workspaces.
  async stopAll(): Promise<void> {
    for (const [id, job] of this.jobs) if (job.running) this.stop(id);
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
}
