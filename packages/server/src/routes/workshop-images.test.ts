import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, open, rm, symlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CompleteInput } from "@master-ai/shared";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { DocumentService } from "../services/documents.js";
import { textToDoc } from "../services/proposals.js";
import { MediaService } from "../services/media.js";
import { WorkshopImageService } from "../services/workshop-images.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=", "base64");
const opened: { app: ReturnType<typeof buildApp>; sqlite: ReturnType<typeof createDb>["sqlite"]; root: string }[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "workshop-images-test-"));
  const { db, sqlite } = createDb(":memory:");
  const campaigns = new CampaignService(db);
  const documents = new DocumentService(db);
  const campaign = campaigns.create({ name: "Тестовые портреты" });
  const other = campaigns.create({ name: "Другая кампания" });
  const doc = documents.create({ campaignId: campaign.id, type: "npc", title: "Смотритель маяка", contentJson: textToDoc("Сила 3. Пароль: северный ветер."), fields: { health: 7 } });
  const foreignDoc = documents.create({ campaignId: other.id, type: "npc", title: "Чужой персонаж" });
  const inputs: CompleteInput[] = [];
  let answer = "Ответ";
  const app = buildApp({ db, generatedImagesDir: root, llm: { async *complete(input) { inputs.push(input); yield answer; } } });
  const file = join(root, "portrait.png");
  await writeFile(file, png);
  const imageService = new WorkshopImageService(documents, new MediaService(db), root);
  const fixture = { app, sqlite, root, campaign, other, doc, foreignDoc, file, inputs, documents, imageService, setAnswer: (value: string) => { answer = value; } };
  opened.push(fixture);
  return fixture;
}
afterEach(async () => { for (const f of opened.splice(0)) { await f.app.close(); f.sqlite.close(); await rm(f.root, { recursive: true, force: true }); } });

function attach(f: Awaited<ReturnType<typeof setup>>, attachments: unknown[], campaignId = f.campaign.id) {
  return f.app.inject({ method: "POST", url: `/api/campaigns/${campaignId}/image-attachments`, payload: { attachments } });
}

describe("workshop image attachments", () => {
  it("stores a generated file in the entity gallery without rewriting text and reuses it on retries", async () => {
    const f = await setup();
    const request = [{ documentId: f.doc.id, path: f.file }];
    const response = await attach(f, request);
    expect(response.statusCode).toBe(200);
    const result = response.json().results[0];
    expect(result).toMatchObject({ documentId: f.doc.id, documentTitle: f.doc.title, image: { name: "portrait.png", mimeType: "image/png" } });
    const gallery = (await f.app.inject(`/api/documents/${f.doc.id}/images`)).json();
    expect(gallery).toEqual([result.image]);
    expect((await f.app.inject(`/api/images/${result.image.id}`)).rawPayload).toEqual(png);
    const current = (await f.app.inject(`/api/documents/${f.doc.id}`)).json();
    expect(current.contentJson).toEqual(f.doc.contentJson);
    expect(current.fields).toEqual({ health: 7 });
    expect((await attach(f, request)).json().results[0].image.id).toBe(result.image.id);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 1 });
  });

  it("attaches uploaded images and isolates both targets and media by campaign", async () => {
    const f = await setup();
    const upload = await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/images`, payload: { name: "uploaded.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` } });
    const image = upload.json();
    const foreign = await f.app.inject({ method: "POST", url: `/api/campaigns/${f.other.id}/images`, payload: { name: "foreign.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` } });
    const result = (await attach(f, [
      { documentId: f.foreignDoc.id, imageId: image.id },
      { documentId: f.doc.id, imageId: foreign.json().id },
      { documentId: f.doc.id, imageId: image.id },
    ])).json().results;
    expect(result[0].error).toBeTruthy();
    expect(result[0].documentTitle).not.toBe(f.foreignDoc.title);
    expect(result[1].error).toBeTruthy();
    expect(result[2].image.id).toBe(image.id);
    expect((await f.app.inject(`/api/documents/${f.foreignDoc.id}/images`)).json()).toEqual([]);
  });

  it("rejects ambiguous sources and invalid batch sizes before attachment", async () => {
    const f = await setup();
    for (const requests of [[], Array.from({ length: 51 }, () => ({ documentId: f.doc.id, path: f.file })), [{ documentId: f.doc.id }], [{ documentId: f.doc.id, path: f.file, imageId: f.doc.id }]]) {
      expect((await attach(f, requests)).statusCode).toBe(400);
    }
    expect((await attach(f, [{ documentId: f.doc.id, path: f.file }], f.doc.id)).statusCode).toBe(404);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
  });

  it("rejects out-of-root files, symlink escapes, directories, missing files and invalid bytes without losing valid items", async () => {
    const f = await setup();
    const outside = await mkdtemp(join(tmpdir(), "outside-generated-test-"));
    try {
      const secret = join(outside, "private.png");
      await writeFile(secret, png);
      await symlink(secret, join(f.root, "escape.png"));
      await writeFile(join(f.root, "fake.png"), "not an image");
      await writeFile(join(f.root, "large.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
      const paths = [secret, join(f.root, "escape.png"), join(f.root, "missing.png"), f.root, join(f.root, "fake.png"), join(f.root, "large.png"), "https://example.com/portrait.png", f.file];
      const result = (await attach(f, paths.map((path) => ({ documentId: f.doc.id, path })))).json().results;
      expect(result).toHaveLength(8);
      expect(result.slice(0, 7).every((r: { error?: string; image?: unknown }) => r.error && !r.image)).toBe(true);
      expect(result[7].image.id).toBeTruthy();
      expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 1 });
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("executes image actions returned by the assistant and persists verified results in the conversation", async () => {
    const f = await setup();
    f.setAnswer('Передаю портрет для карточки.\n```json\n' + JSON.stringify({ imageAttachments: [{ documentId: f.doc.id, path: f.file }] }) + '\n```');
    const response = await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Прикрепи портрет к персонажу" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().imageAttachments?.[0].image.id).toBeTruthy();
    const messages = (await f.app.inject(`/api/campaigns/${f.campaign.id}/conversation`)).json();
    expect(messages.at(-1).meta.imageAttachments).toEqual(response.json().imageAttachments);
    expect(messages.at(-1).content).not.toContain("imageAttachments");
    expect(JSON.stringify(messages)).not.toContain("data:image");
    f.setAnswer("Изображение прикреплено.");
    await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Какой портрет прикреплён?" } });
    expect(f.inputs.at(-1)?.system).toContain(response.json().imageAttachments[0].image.id);
  });

  it.skipIf(process.platform === "win32")("rejects named pipes without blocking the rest of the batch", async () => {
    const f = await setup();
    const fifo = join(f.root, "pipe.png");
    execFileSync("mkfifo", [fifo]);
    const response = attach(f, [{ documentId: f.doc.id, path: fifo }, { documentId: f.doc.id, path: f.file }]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      response.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 500); }),
    ]);
    if (timer) clearTimeout(timer);
    // Освобождаем зависший open старой реализации, чтобы RED не оставлял процесс.
    if (!completed) { const writer = await open(fifo, constants.O_RDWR | constants.O_NONBLOCK); await response; await writer.close(); }
    expect(completed).toBe(true);
    const results = (await response).json().results;
    expect(results[0].error).toBeTruthy();
    expect(results[1].image.id).toBeTruthy();
  });

  it("waits for background attachment completion before publishing the finished workshop response", async () => {
    const f = await setup();
    f.setAnswer('```json\n' + JSON.stringify({ imageAttachments: [{ documentId: f.doc.id, path: f.file }] }) + '\n```');
    const start = await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm/start`, payload: { message: "Прикрепи портрет" } });
    expect(start.statusCode).toBe(202);
    await expect.poll(async () => (await f.app.inject(`/api/campaigns/${f.campaign.id}/brainstorm/status`)).json().running).toBe(false);
    const messages = (await f.app.inject(`/api/campaigns/${f.campaign.id}/conversation`)).json();
    expect(messages.at(-1).meta.imageAttachments?.[0].image.id).toBeTruthy();
    expect((await f.app.inject(`/api/documents/${f.doc.id}/images`)).json()).toHaveLength(1);
  });

  it("remaps result images and target entities on export/import", async () => {
    const f = await setup();
    f.setAnswer('```json\n' + JSON.stringify({ imageAttachments: [{ documentId: f.doc.id, path: f.file }] }) + '\n```');
    await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Прикрепи портрет" } });
    const data = (await f.app.inject(`/api/campaigns/${f.campaign.id}/export-json`)).json();
    expect(data.messages.at(-1).meta.imageAttachments?.[0].image.id).toBeTruthy();
    const imported = (await f.app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: data })).json();
    const docs = (await f.app.inject(`/api/campaigns/${imported.id}/documents`)).json();
    const history = (await f.app.inject(`/api/campaigns/${imported.id}/conversation`)).json();
    const result = history.at(-1).meta.imageAttachments[0];
    expect(result.documentId).toBe(docs[0].id);
    expect(result.documentId).not.toBe(f.doc.id);
    expect(result.image.id).not.toBe(data.images[0].id);
    expect((await f.app.inject(`/api/documents/${docs[0].id}/images`)).json()).toEqual([result.image]);
  });

  it("exposes current gallery bindings to the assistant and refreshes them after detaching", async () => {
    const f = await setup();
    const image = (await attach(f, [{ documentId: f.doc.id, path: f.file }])).json().results[0].image;
    const ask = () => f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Какие изображения у персонажа?" } });
    const galleryContext = () => JSON.parse(f.inputs.at(-1)!.system!.split("\n\nКонтекст кампании (JSON):\n").at(-1)!).documents[0].images;
    await ask();
    expect(galleryContext()).toEqual([image]);
    await f.app.inject({ method: "DELETE", url: `/api/documents/${f.doc.id}/images/${image.id}` });
    await ask();
    expect(galleryContext()).toEqual([]);
  });

  it("records recovery results only on an assistant message from the same workshop", async () => {
    const f = await setup();
    await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Покажи портрет" } });
    const history = (await f.app.inject(`/api/campaigns/${f.campaign.id}/conversation`)).json();
    const requests = [{ documentId: f.doc.id, path: f.file }];
    for (const messageId of [history[0].id, f.foreignDoc.id]) {
      expect((await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/image-attachments`, payload: { attachments: requests, messageId } })).statusCode).toBe(404);
    }
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
    const response = await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/image-attachments`, payload: { attachments: requests, messageId: history.at(-1).id } });
    expect(response.statusCode).toBe(200);
    expect((await f.app.inject(`/api/campaigns/${f.campaign.id}/conversation`)).json().at(-1).meta.imageAttachments).toEqual(response.json().results);
  });

  it("does not import images after cancellation or if the target disappears while reading", async () => {
    const f = await setup();
    const abort = new AbortController();
    abort.abort();
    const request = [{ documentId: f.doc.id, path: f.file }];
    expect((await f.imageService.attach(f.campaign.id, request, abort.signal))[0].error).toBeTruthy();
    const pending = f.imageService.attach(f.campaign.id, request);
    f.documents.delete(f.doc.id);
    expect((await pending)[0].error).toBeTruthy();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
  });
});
