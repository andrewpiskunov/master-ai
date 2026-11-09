import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CompleteInput } from "@master-ai/shared";
import { createDb } from "../db/client.js";
import { buildApp } from "../app.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=";
const opened: ReturnType<typeof setup>[] = [];
function setup() {
  const { db, sqlite } = createDb(":memory:");
  const seen: CompleteInput[] = [];
  const app = buildApp({ db, llm: { async *complete(input) { seen.push(input); yield "Ответ"; } } });
  return { app, sqlite, seen };
}
function make() { const fixture = setup(); opened.push(fixture); return fixture; }
afterEach(async () => { for (const { app, sqlite } of opened.splice(0)) { await app.close(); sqlite.close(); } });
async function campaign(app: ReturnType<typeof setup>["app"]) {
  return (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Иллюстрации" } })).json();
}
async function document(app: ReturnType<typeof setup>["app"], campaignId: string) {
  return (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId, type: "session", title: "Сессия" } })).json();
}
async function upload(app: ReturnType<typeof setup>["app"], campaignId: string, dataUrl = png) {
  const res = await app.inject({ method: "POST", url: `/api/campaigns/${campaignId}/images`, payload: { name: "карта.png", dataUrl } });
  expect(res.statusCode).toBe(201);
  return res.json();
}
async function waitJob(app: ReturnType<typeof setup>["app"], url: string) {
  for (let n = 0; n < 30; n++) {
    if (!(await app.inject({ method: "GET", url })).json().running) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("job did not finish");
}

describe("campaign image API", () => {
  it("stores bytes, serves a safe MIME, and attaches without expanding document lists", async () => {
    const { app } = make(); const c = await campaign(app); const d = await document(app, c.id);
    const image = await upload(app, c.id);
    expect(image).toEqual({ id: expect.any(String), name: "карта.png", mimeType: "image/png" });
    const served = await app.inject({ method: "GET", url: `/api/images/${image.id}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.rawPayload).toEqual(Buffer.from(png.split(",")[1], "base64"));
    const attach = await app.inject({ method: "POST", url: `/api/documents/${d.id}/images`, payload: { imageId: image.id } });
    expect(attach.statusCode).toBe(200); expect(attach.json()).toEqual([image]);
    expect((await app.inject({ method: "POST", url: `/api/documents/${d.id}/images`, payload: { imageId: image.id } })).json()).toEqual([image]);
    expect((await app.inject({ method: "GET", url: `/api/documents/${d.id}/images` })).json()).toEqual([image]);
    expect((await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` })).body).not.toContain("data:image");
    expect((await app.inject({ method: "DELETE", url: `/api/documents/${d.id}/images/${image.id}` })).json()).toEqual([]);
  });

  it("rejects unsupported data, mismatched signatures, invalid base64 and files above 10 MiB", async () => {
    const { app } = make(); const c = await campaign(app);
    const bad = ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", png.replace("image/png", "image/jpeg"), "data:image/png;base64,not!base64", "data:image/png;base64,aGVsbG8="];
    for (const dataUrl of bad) {
      const res = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/images`, payload: { name: "bad", dataUrl } });
      expect(res.statusCode).toBe(400);
    }
    const large = Buffer.alloc(10 * 1024 * 1024 + 1); Buffer.from("89504e470d0a1a0a", "hex").copy(large);
    const oversized = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/images`, payload: { name: "large", dataUrl: `data:image/png;base64,${large.toString("base64")}` } });
    expect(oversized.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/campaigns/${randomUUID()}/images`, payload: { name: "x", dataUrl: png } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/images/${randomUUID()}` })).statusCode).toBe(404);
  });

  it("allows valid uploads above Fastify's default body limit and isolates campaign ownership", async () => {
    const { app } = make(); const c = await campaign(app); const other = await campaign(app); const d = await document(app, other.id);
    const bytes = Buffer.alloc(1024 * 1024); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
    const image = await upload(app, c.id, `data:image/png;base64,${bytes.toString("base64")}`);
    const foreign = await app.inject({ method: "POST", url: `/api/documents/${d.id}/images`, payload: { imageId: image.id } });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error).toContain("этой кампании");
    expect((await app.inject({ method: "POST", url: `/api/documents/${d.id}/assistant`, payload: { message: "x", imageIds: [image.id] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/campaigns/${other.id}/brainstorm/start`, payload: { message: "x", imageIds: [image.id] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json()).toEqual([]);
  });

  it("resolves image-only workshop messages and saved history to actual LLM image bytes", async () => {
    const { app, seen } = make(); const c = await campaign(app); const image = await upload(app, c.id);
    const start = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm/start`, payload: { message: "", imageIds: [image.id] } });
    expect(start.statusCode).toBe(202); await waitJob(app, `/api/campaigns/${c.id}/brainstorm/status`);
    await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm`, payload: { message: "Что на карте?" } });
    expect(seen.at(-1)?.messages.some((m) => m.content === "" && m.images?.[0]?.dataUrl === png)).toBe(true);
    const history = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/conversation` })).json();
    expect(history.find((m: { content: string }) => m.content === "").meta.images).toEqual([image]);
    expect(JSON.stringify(history)).not.toContain("data:image");
  });

  it("preserves game actor metadata while resolving current and historical assistant images", async () => {
    const { app, seen } = make(); const c = await campaign(app); const d = await document(app, c.id); const image = await upload(app, c.id);
    const first = await app.inject({ method: "POST", url: `/api/documents/${d.id}/assistant`, payload: { message: "Осматриваю карту", imageIds: [image.id], mode: "game", meta: { actorName: "Алдар", actorKind: "pc" } } });
    expect(first.statusCode).toBe(202); await waitJob(app, `/api/documents/${d.id}/assistant`);
    expect(seen.at(-1)?.messages[0]).toEqual({ role: "user", content: "Действие (Алдар): Осматриваю карту", images: [{ name: "карта.png", dataUrl: png }] });
    const second = await app.inject({ method: "POST", url: `/api/documents/${d.id}/assistant`, payload: { message: "", imageIds: [image.id] } });
    expect(second.statusCode).toBe(202); await waitJob(app, `/api/documents/${d.id}/assistant`);
    expect(seen.at(-1)?.messages[0].images?.[0].dataUrl).toBe(png);
    const history = (await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json();
    expect(history[0].meta).toEqual({ actorName: "Алдар", actorKind: "pc", images: [image] });
    expect((await app.inject({ method: "PATCH", url: `/api/messages/${history[0].id}/meta`, payload: { log: { title: "Карта", important: true } } })).json().meta.images).toEqual([image]);
  });

  it("validates image counts, missing references and blank messages before saving", async () => {
    const { app } = make(); const c = await campaign(app); const d = await document(app, c.id);
    for (const url of [`/api/campaigns/${c.id}/brainstorm/start`, `/api/campaigns/${c.id}/brainstorm`, `/api/documents/${d.id}/assistant`]) {
      for (const payload of [{ message: " " }, { message: "x", imageIds: [randomUUID()] }, { message: "x", imageIds: Array.from({ length: 5 }, () => randomUUID()) }]) {
        expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(400);
      }
    }
    expect((await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json()).toEqual([]);
  });

  it("persists image-only conversation messages with server-resolved metadata", async () => {
    const { app } = make(); const c = await campaign(app); const d = await document(app, c.id); const image = await upload(app, c.id);
    const res = await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "user", content: "", imageIds: [image.id] } });
    expect(res.statusCode).toBe(201); expect(res.json().meta.images).toEqual([image]);
    expect((await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "user", content: " " } })).statusCode).toBe(400);
  });

  it("exports image bytes, remaps chat and document references on import, and cleans deletions", async () => {
    const { app, sqlite } = make(); const c = await campaign(app); const d = await document(app, c.id); const image = await upload(app, c.id);
    await app.inject({ method: "POST", url: `/api/documents/${d.id}/images`, payload: { imageId: image.id } });
    await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "user", content: "Карта", imageIds: [image.id] } });
    const data = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/export-json` })).json();
    expect(data.images[0].dataUrl).toBe(png); expect(data.documentImages).toEqual([{ documentId: d.id, imageId: image.id }]);
    const importedRes = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: data });
    expect(importedRes.statusCode).toBe(201); const imported = importedRes.json();
    const docs = (await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/documents` })).json();
    const attached = (await app.inject({ method: "GET", url: `/api/documents/${docs[0].id}/images` })).json();
    expect(attached[0].id).not.toBe(image.id); expect(attached[0].name).toBe("карта.png");
    const history = (await app.inject({ method: "GET", url: `/api/documents/${docs[0].id}/conversation` })).json();
    expect(history[0].meta.images).toEqual(attached);
    expect((await app.inject({ method: "GET", url: `/api/images/${attached[0].id}` })).rawPayload).toEqual(Buffer.from(png.split(",")[1], "base64"));
    await app.inject({ method: "DELETE", url: `/api/documents/${docs[0].id}` });
    expect(sqlite.prepare("SELECT count(*) AS n FROM document_images WHERE document_id = ?").get(docs[0].id)).toEqual({ n: 0 });
    await app.inject({ method: "DELETE", url: `/api/campaigns/${imported.id}` });
    expect((await app.inject({ method: "GET", url: `/api/images/${attached[0].id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/images/${image.id}` })).statusCode).toBe(200);
    await app.inject({ method: "DELETE", url: `/api/campaigns/${c.id}` });
    expect(sqlite.prepare("SELECT count(*) AS n FROM document_images").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
  });

  it("rejects invalid imported media and broken references without leaving a partial campaign", async () => {
    const { app, sqlite } = make(); const c = await campaign(app); const d = await document(app, c.id); const image = await upload(app, c.id);
    const data = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/export-json` })).json();
    const invalidBytes = structuredClone(data); invalidBytes.images[0].dataUrl = png.replace("image/png", "image/jpeg");
    const missingImage = structuredClone(data); missingImage.documentImages = [{ documentId: d.id, imageId: randomUUID() }];
    const missingChatImage = structuredClone(data);
    missingChatImage.messages[0].meta = { images: [{ ...image, id: randomUUID() }] };
    const duplicateImage = structuredClone(data); duplicateImage.images.push(duplicateImage.images[0]);
    for (const payload of [invalidBytes, missingImage, missingChatImage, duplicateImage]) {
      expect((await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload })).statusCode).toBe(400);
      expect(sqlite.prepare("SELECT count(*) AS n FROM campaigns").get()).toEqual({ n: 1 });
      expect(sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 1 });
    }
  });

  it("imports existing version 1 exports without image fields", async () => {
    const { app } = make();
    const legacy = { format: "master-ai-campaign", version: 1, campaign: { name: "Старая кампания" }, documents: [{ id: "old-document", title: "Архив", type: "note" }] };
    const res = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: legacy });
    expect(res.statusCode).toBe(201);
    const docs = (await app.inject({ method: "GET", url: `/api/campaigns/${res.json().id}/documents` })).json();
    expect(docs[0].title).toBe("Архив");
    expect((await app.inject({ method: "GET", url: `/api/documents/${docs[0].id}/images` })).json()).toEqual([]);
  });
});
