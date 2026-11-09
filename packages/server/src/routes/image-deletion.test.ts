import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import sharp from "sharp";
import { CompleteInputSchema, type CompleteInput, type LlmImage } from "@master-ai/shared";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { ConversationService } from "../services/conversations.js";
import { DocumentService } from "../services/documents.js";
import { MediaService } from "../services/media.js";
import { WorkshopImageService } from "../services/workshop-images.js";

const opened: ReturnType<typeof setup>[] = [];
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=";
function setup(options: { answer?: string; generate?: () => Promise<LlmImage> } = {}) {
  const { sqlite } = createDb(":memory:");
  const queries: string[] = [];
  const db = drizzle(sqlite, { logger: { logQuery(query) { queries.push(query); } } });
  const seen: CompleteInput[] = [];
  const app = buildApp({ db,
    llm: { async *complete(input) { seen.push(CompleteInputSchema.parse(input)); yield options.answer ?? "Ответ"; } },
    imageGenerator: { generate: options.generate ?? (async () => ({ name: "портрет.png", dataUrl: png })) },
  });
  const campaigns = new CampaignService(db);
  const documents = new DocumentService(db);
  const conversations = new ConversationService(db);
  const media = new MediaService(db);
  return { app, db, sqlite, queries, seen, campaigns, documents, conversations, media };
}
function make(options?: Parameters<typeof setup>[0]) { const fixture = setup(options); opened.push(fixture); return fixture; }
afterEach(async () => { for (const fixture of opened.splice(0)) { await fixture.app.close(); fixture.sqlite.close(); } });
async function finish(f: ReturnType<typeof setup>, url: string) {
  await expect.poll(async () => (await f.app.inject(url)).json().running).toBe(false);
  expect((await f.app.inject(url)).json().error).toBeNull();
}

describe("permanent image deletion", () => {
  it("omits an image-only game action after deletion before adding its actor prefix", async () => {
    const f = make(); const c = f.campaigns.create({ name: "Игра" });
    const doc = f.documents.create({ campaignId: c.id, type: "session", title: "Ночь" });
    const image = f.media.create(c.id, { name: "карта.png", dataUrl: png });
    const conv = f.conversations.getOrCreateForDocument(c.id, doc.id);
    f.conversations.addMessage(conv.id, "user", "", { actorName: "Алдар", actorKind: "pc", images: [image] });
    f.media.delete(image.id);
    const url = `/api/documents/${doc.id}/assistant`;
    expect((await f.app.inject({ method: "POST", url, payload: { message: "Продолжаем", mode: "game" } })).statusCode).toBe(202);
    await finish(f, url);
    expect(f.seen.at(-1)?.messages).toEqual([{ role: "user", content: "Продолжаем" }]);
  });

  it("checks attachment ownership and completion using metadata without reading original bytes", async () => {
    const f = make(); const c = f.campaigns.create({ name: "Метаданные" });
    const doc = f.documents.create({ campaignId: c.id, type: "npc", title: "Глеб" });
    const image = f.media.create(c.id, { name: "портрет.png", dataUrl: png });
    f.queries.length = 0;
    const result = await new WorkshopImageService(f.documents, f.media).attach(c.id, [{ documentId: doc.id, imageId: image.id }]);
    expect(result).toMatchObject([{ documentId: doc.id, image }]);
    expect(f.queries.filter((query) => query.includes('"data_url"'))).toEqual([]);
  });

  it("removes shared media and campaign references while preserving other data and cached images", async () => {
    const f = make();
    const c = f.campaigns.create({ name: "Кампания" });
    const other = f.campaigns.create({ name: "Другая" });
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "#abc" } }).png().toBuffer();
    const image = f.media.create(c.id, { name: "общая.png", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
    const keep = f.media.create(c.id, { name: "осталась.png", dataUrl: png });
    const foreign = f.media.create(other.id, { name: "другая.png", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
    const contentJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Текст карточки" }] }] };
    const first = f.documents.create({ campaignId: c.id, type: "npc", title: "Первый", contentJson, fields: { health: 7, tags: ["маг"] } });
    const second = f.documents.create({ campaignId: c.id, type: "location", title: "Второй" });
    const stale = f.documents.create({ campaignId: c.id, type: "note", title: "Старая ссылка", fields: { avatarImageId: image.id, text: "сохранить" } });
    const untouched = f.documents.create({ campaignId: c.id, type: "note", title: "Без картинки" });
    const otherDoc = f.documents.create({ campaignId: other.id, type: "note", title: "Другая карточка", fields: { avatarImageId: image.id } });
    for (const doc of [first, second]) { f.media.attach(doc.id, image.id); f.media.setAvatar(doc.id, image.id); }
    f.media.attach(first.id, keep.id);
    f.media.setCampaignCover(c.id, image.id);
    f.media.setCampaignCover(other.id, foreign.id);
    const unchangedFields = '{ "custom" : [1, 2], "text" : "исходный JSON" }';
    f.sqlite.prepare("UPDATE documents SET fields = ? WHERE id = ?").run(unchangedFields, untouched.id);
    const untouchedMeta = '{ "actorName" : "Мастер", "custom" : true }';
    const failed = { documentId: first.id, documentTitle: first.title, error: "Нет файла" };
    const remainingResult = { documentId: first.id, documentTitle: first.title, image: keep };
    const metadata = { actorName: "Алдар", actorKind: "pc" as const, log: { title: "Карта", important: true }, images: [image, keep], imageAttachments: [{ documentId: first.id, documentTitle: first.title, image, isAvatar: true }, remainingResult, failed] };
    const convs = [f.conversations.getOrCreateForCampaign(c.id), f.conversations.getOrCreateForDocument(c.id, first.id)];
    const changed = convs.map((conv) => f.conversations.addMessage(conv.id, "user", "Смотрю карту", metadata));
    const empty = f.conversations.addMessage(convs[0].id, "user", "", { images: [image] });
    const unchanged = f.conversations.addMessage(convs[0].id, "assistant", "Обычный ответ");
    f.sqlite.prepare("UPDATE messages SET meta = ? WHERE id = ?").run(untouchedMeta, unchanged.id);
    const otherConv = f.conversations.getOrCreateForCampaign(other.id);
    const otherMessage = f.conversations.addMessage(otherConv.id, "user", "Другая кампания", { images: [foreign] });
    const otherBefore = f.sqlite.prepare("SELECT * FROM messages WHERE id = ?").get(otherMessage.id);
    await f.media.getThumbnail(image.id, 128);
    await f.media.getThumbnail(foreign.id, 128);
    f.queries.length = 0;

    const deleted = await f.app.inject({ method: "DELETE", url: `/api/images/${image.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(f.queries.filter((query) => query.includes('"data_url"'))).toEqual([]);
    expect(f.media.listForCampaign(c.id)).toEqual([keep]);
    expect(f.media.listForDocument(first.id)).toEqual([keep]);
    expect(f.media.listForDocument(second.id)).toEqual([]);
    expect(f.documents.get(first.id)).toMatchObject({ fields: { health: 7, tags: ["маг"] }, contentJson, avatar: keep });
    expect(f.documents.get(first.id)?.fields).not.toHaveProperty("avatarImageId");
    expect(f.documents.get(second.id)).toMatchObject({ fields: {}, avatar: null });
    expect(f.documents.get(stale.id)?.fields).toEqual({ text: "сохранить" });
    expect(f.documents.get(otherDoc.id)?.fields.avatarImageId).toBe(image.id);
    expect(f.sqlite.prepare("SELECT fields FROM documents WHERE id = ?").get(untouched.id)).toEqual({ fields: unchangedFields });
    expect(f.campaigns.get(c.id)?.cover).toBeNull();
    expect(f.sqlite.prepare("SELECT cover_image_id FROM campaigns WHERE id = ?").get(c.id)).toEqual({ cover_image_id: null });
    expect(f.campaigns.get(other.id)?.cover).toEqual(foreign);
    for (const [index, conv] of convs.entries()) {
      expect(f.conversations.listMessages(conv.id).find((message) => message.id === changed[index].id)).toMatchObject({ content: "Смотрю карту", meta: { ...metadata, images: [keep], imageAttachments: [remainingResult, failed] } });
    }
    expect(f.conversations.listMessages(convs[0].id).find((message) => message.id === empty.id)).toMatchObject({ content: "" });
    expect(f.conversations.listMessages(convs[0].id).find((message) => message.id === empty.id)?.meta?.images ?? []).toEqual([]);
    expect(f.sqlite.prepare("SELECT meta FROM messages WHERE id = ?").get(unchanged.id)).toEqual({ meta: untouchedMeta });
    expect(f.sqlite.prepare("SELECT * FROM messages WHERE id = ?").get(otherMessage.id)).toEqual(otherBefore);
    expect(f.sqlite.prepare("SELECT image_id FROM image_thumbnails").all()).toEqual([{ image_id: foreign.id }]);
    expect((await f.app.inject(`/api/images/${image.id}`)).statusCode).toBe(404);
    expect((await f.app.inject(`/api/images/${image.id}/thumbnail`)).statusCode).toBe(404);
    expect((await f.app.inject({ method: "DELETE", url: `/api/images/${image.id}` })).statusCode).toBe(404);

    expect((await f.app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm`, payload: { message: "Продолжай" } })).statusCode).toBe(200);
    expect((await f.app.inject({ method: "POST", url: `/api/documents/${first.id}/assistant`, payload: { message: "Продолжай" } })).statusCode).toBe(202);
    await finish(f, `/api/documents/${first.id}/assistant`);
    expect(f.seen).toHaveLength(2);
    for (const input of f.seen) {
      expect(input.messages.every((message) => message.content.trim() || message.images?.length)).toBe(true);
      expect(input.messages.some((message) => message.images?.[0]?.name === keep.name)).toBe(true);
      expect(input.system).not.toContain(image.id);
    }
    const exported = (await f.app.inject(`/api/campaigns/${c.id}/export-json`)).json();
    expect(JSON.stringify(exported)).not.toContain(image.id);
    const imported = await f.app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: exported });
    expect(imported.statusCode).toBe(201);
    expect((await f.app.inject(`/api/campaigns/${imported.json().id}/images`)).json()).toHaveLength(1);
  });

  it("safely skips malformed fields and metadata and preserves an unrelated cover", async () => {
    const f = make(); const c = f.campaigns.create({ name: "Архив" });
    const image = f.media.create(c.id, { name: "удалить.png", dataUrl: png });
    const keep = f.media.create(c.id, { name: "обложка.png", dataUrl: png });
    f.media.setCampaignCover(c.id, keep.id);
    const doc = f.documents.create({ campaignId: c.id, title: "Повреждённая карточка", type: "note" });
    const conv = f.conversations.getOrCreateForCampaign(c.id);
    const message = f.conversations.addMessage(conv.id, "user", "Сохранить текст");
    for (const raw of ["{broken", "null", "[]", '"text"']) {
      f.sqlite.prepare("UPDATE documents SET fields = ? WHERE id = ?").run(raw, doc.id);
      f.sqlite.prepare("UPDATE messages SET meta = ? WHERE id = ?").run(raw, message.id);
      const next = f.media.create(c.id, { name: "временная.png", dataUrl: png });
      expect((await f.app.inject({ method: "DELETE", url: `/api/images/${next.id}` })).statusCode).toBe(200);
      expect(f.sqlite.prepare("SELECT fields FROM documents WHERE id = ?").get(doc.id)).toEqual({ fields: raw });
      expect(f.sqlite.prepare("SELECT meta FROM messages WHERE id = ?").get(message.id)).toEqual({ meta: raw });
    }
    expect((await f.app.inject({ method: "DELETE", url: `/api/images/${image.id}` })).statusCode).toBe(200);
    expect(f.campaigns.get(c.id)?.cover?.id).toBe(keep.id);
    expect((await f.app.inject({ method: "DELETE", url: `/api/images/${randomUUID()}` })).statusCode).toBe(404);
  });

  it("does not resurrect a thumbnail when the original is deleted while resizing", async () => {
    const f = make(); const c = f.campaigns.create({ name: "Миниатюра" });
    const bytes = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#abc" } }).png().toBuffer();
    const image = f.media.create(c.id, { name: "карта.png", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` });
    const pending = f.media.getThumbnail(image.id, 128);
    let deleted;
    try { deleted = f.media.delete(image.id); }
    finally { await pending; }
    expect(deleted).toBe(true);
    expect(await pending).toBeUndefined();
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM image_thumbnails").get()).toEqual({ n: 0 });
  });

  it("hides a deleted image from a completed generation status", async () => {
    const f = make(); const c = f.campaigns.create({ name: "Портрет" });
    const doc = f.documents.create({ campaignId: c.id, title: "Глеб", type: "npc" });
    expect((await f.app.inject({ method: "POST", url: `/api/documents/${doc.id}/image-generation`, payload: { prompt: "Портрет" } })).statusCode).toBe(202);
    await finish(f, `/api/documents/${doc.id}/image-generation`);
    const status = (await f.app.inject(`/api/documents/${doc.id}/image-generation`)).json();
    expect(status.image.id).toBeTruthy();
    await f.app.inject({ method: "DELETE", url: `/api/images/${status.image.id}` });
    expect((await f.app.inject(`/api/documents/${doc.id}/image-generation`)).json()).toEqual({ running: false, error: null });
  });

  it.each(["assistant", "workshop"] as const)("does not restore deleted references when an active %s attachment batch finishes", async (kind) => {
    let release!: (image: LlmImage) => void;
    let started!: () => void;
    const generation = new Promise<LlmImage>((resolve) => { release = resolve; });
    const generating = new Promise<void>((resolve) => { started = resolve; });
    const options = { answer: "", generate: () => { started(); return generation; } };
    const f = make(options); const c = f.campaigns.create({ name: "В работе" });
    const doc = f.documents.create({ campaignId: c.id, type: "npc", title: "Глеб" });
    const image = f.media.create(c.id, { name: "старый.png", dataUrl: png });
    options.answer = 'Прикрепляю изображения.\n```json\n' + JSON.stringify({ imageAttachments: [
      { documentId: doc.id, imageId: image.id }, { documentId: doc.id, prompt: "Новый портрет" },
    ] }) + '\n```';
    const url = kind === "assistant" ? `/api/documents/${doc.id}/assistant` : `/api/campaigns/${c.id}/brainstorm/start`;
    const statusUrl = kind === "assistant" ? url : `/api/campaigns/${c.id}/brainstorm/status`;
    try {
      expect((await f.app.inject({ method: "POST", url, payload: { message: "Прикрепи обе картинки" } })).statusCode).toBe(202);
      await generating;
      expect((await f.app.inject({ method: "DELETE", url: `/api/images/${image.id}` })).statusCode).toBe(200);
    } finally { release({ name: "новый.png", dataUrl: png }); }
    await finish(f, statusUrl);
    const conv = kind === "assistant" ? f.conversations.getOrCreateForDocument(c.id, doc.id) : f.conversations.getOrCreateForCampaign(c.id);
    const messages = f.conversations.listMessages(conv.id);
    expect(JSON.stringify(messages)).not.toContain(image.id);
    expect(messages.at(-1)?.meta?.imageAttachments).toHaveLength(1);
    expect(messages.at(-1)?.content).toBe("Прикрепляю изображения.");
    const exported = (await f.app.inject(`/api/campaigns/${c.id}/export-json`)).json();
    expect((await f.app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: exported })).statusCode).toBe(201);
  });
});
