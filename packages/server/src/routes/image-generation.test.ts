import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { DocumentService } from "../services/documents.js";
import { MediaService } from "../services/media.js";
import type { ImageGenerationInput, ImageGenerator } from "../llm/image-generation.js";
import { registerImageGenerationRoutes } from "./image-generation.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=";
const image = { name: "illustration.png", dataUrl: `data:image/png;base64,${PNG}` };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function setup(generator: ImageGenerator) {
  const { db, sqlite } = createDb(":memory:");
  const documentsSvc = new DocumentService(db);
  const campaignsSvc = new CampaignService(db);
  const mediaSvc = new MediaService(db);
  const campaign = campaignsSvc.create({ name: "Маяк" });
  const document = documentsSvc.create({ campaignId: campaign.id, title: "Глеб", type: "npc", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Смотритель маяка" }] }] } });
  const app = Fastify();
  registerImageGenerationRoutes(app, { documentsSvc, mediaSvc, imageGenerator: generator });
  cleanups.push(async () => { await app.close(); sqlite.close(); });
  return { app, documentsSvc, mediaSvc, document, sqlite };
}

async function status(app: FastifyInstance, id: string) {
  const response = await app.inject({ method: "GET", url: `/api/documents/${id}/image-generation` });
  return response.json();
}
async function finish(app: FastifyInstance, id: string) {
  await expect.poll(async () => (await status(app, id)).running).toBe(false);
  return status(app, id);
}

describe("document image generation routes", () => {
  it("returns 202, derives context from the persisted entity, then saves and attaches the image", async () => {
    const seen: ImageGenerationInput[] = [];
    const { app, document, mediaSvc } = setup({ async generate(input) { seen.push(input); return image; } });
    const response = await app.inject({ method: "POST", url: `/api/documents/${document.id}/image-generation`, payload: { prompt: "Акварельный портрет" } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ started: true });
    const final = await finish(app, document.id);
    expect(final.error).toBeNull();
    expect(final.image.mimeType).toBe("image/png");
    expect(final.image.name).toBe("Глеб — портрет.png");
    expect(mediaSvc.listForDocument(document.id)).toEqual([final.image]);
    expect(seen).toEqual([{ document: { title: "Глеб", type: "npc", text: "Смотритель маяка" }, prompt: "Акварельный портрет" }]);
  });

  it("validates prompts and returns 404 for unknown entities on every endpoint", async () => {
    const { app, document } = setup({ async generate() { return image; } });
    expect((await app.inject({ method: "POST", url: `/api/documents/${document.id}/image-generation`, payload: { prompt: "  " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/documents/${document.id}/image-generation`, payload: { prompt: "x".repeat(10_001) } })).statusCode).toBe(400);
    for (const [method, path] of [["GET", ""], ["POST", ""], ["POST", "/stop"]] as const) {
      expect((await app.inject({ method, url: `/api/documents/missing/image-generation${path}`, payload: method === "POST" && !path ? { prompt: "Портрет" } : undefined })).statusCode).toBe(404);
    }
  });

  it("rejects a duplicate with 409 and stop prevents attachment", async () => {
    let resolve!: (value: typeof image) => void;
    const result = new Promise<typeof image>((r) => { resolve = r; });
    const { app, document, mediaSvc } = setup({ generate: () => result });
    const request = { method: "POST" as const, url: `/api/documents/${document.id}/image-generation`, payload: { prompt: "Портрет" } };
    expect((await app.inject(request)).statusCode).toBe(202);
    expect((await app.inject(request)).statusCode).toBe(409);
    expect((await status(app, document.id)).running).toBe(true);
    expect((await app.inject({ method: "POST", url: `${request.url}/stop` })).statusCode).toBe(204);
    resolve(image);
    expect(await finish(app, document.id)).toEqual({ running: false, error: null });
    expect(mediaSvc.listForDocument(document.id)).toEqual([]);
  });

  it("does not persist an image if the document was deleted during generation", async () => {
    let resolve!: (value: typeof image) => void;
    const result = new Promise<typeof image>((r) => { resolve = r; });
    const { app, document, documentsSvc, sqlite } = setup({ generate: () => result });
    await app.inject({ method: "POST", url: `/api/documents/${document.id}/image-generation`, payload: { prompt: "Портрет" } });
    documentsSvc.delete(document.id);
    resolve(image);
    await new Promise((r) => setTimeout(r, 0));
    expect(sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
    expect((await app.inject({ method: "GET", url: `/api/documents/${document.id}/image-generation` })).statusCode).toBe(404);
  });

  it("exposes generator errors and rejects invalid generated media", async () => {
    let failing = true;
    const { app, document, mediaSvc } = setup({ async generate() { if (failing) throw new Error("Достигнут лимит Codex"); return { name: "bad.png", dataUrl: "data:image/png;base64,aGVsbG8=" }; } });
    const request = { method: "POST" as const, url: `/api/documents/${document.id}/image-generation`, payload: { prompt: "Портрет" } };
    await app.inject(request);
    expect((await finish(app, document.id)).error).toContain("лимит");
    failing = false;
    expect((await app.inject(request)).statusCode).toBe(202);
    expect((await finish(app, document.id)).error).toBeTruthy();
    expect(mediaSvc.listForDocument(document.id)).toEqual([]);
  });
});
