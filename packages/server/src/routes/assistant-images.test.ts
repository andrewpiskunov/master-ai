import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompleteInput, LlmImage } from "@master-ai/shared";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { DocumentService } from "../services/documents.js";
import { MediaError, MediaService } from "../services/media.js";
import { WorkshopImageService } from "../services/workshop-images.js";
import { textToDoc } from "../services/proposals.js";
import type { ImageGenerationInput, ImageGenerator } from "../llm/image-generation.js";

const png: LlmImage = { name: "generated.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=" };
const opened: { app: ReturnType<typeof buildApp>; sqlite: ReturnType<typeof createDb>["sqlite"] }[] = [];
function setup(generator?: ImageGenerator) {
  const { db, sqlite } = createDb(":memory:");
  const campaigns = new CampaignService(db);
  const documents = new DocumentService(db);
  const media = new MediaService(db);
  const campaign = campaigns.create({ name: "Кампания" });
  const other = campaigns.create({ name: "Чужая кампания" });
  const doc = documents.create({ campaignId: campaign.id, type: "npc", title: "Смотритель маяка", contentJson: textToDoc("Сила 3. Пароль: ветер."), fields: { health: 7 } });
  const foreign = documents.create({ campaignId: other.id, type: "location", title: "Чужая башня" });
  const seen: CompleteInput[] = [];
  const generated: ImageGenerationInput[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  let answer = "Ответ";
  const app = buildApp({ db, imageGenerator: generator ?? { async generate(input, options) { generated.push(input); signals.push(options?.signal); return png; } }, llm: { async *complete(input) { seen.push(input); yield answer; } } });
  const fixture = { app, sqlite, campaign, doc, foreign, documents, media, seen, generated, signals, setAnswer: (value: string) => { answer = value; } };
  opened.push(fixture);
  return fixture;
}
afterEach(async () => { for (const f of opened.splice(0)) { await f.app.close(); f.sqlite.close(); } });

function start(f: ReturnType<typeof setup>, payload: Record<string, unknown> = {}) {
  return f.app.inject({ method: "POST", url: `/api/documents/${f.doc.id}/assistant`, payload: { message: "Нарисуй и поставь аватар", ...payload } });
}
async function waitFinished(f: ReturnType<typeof setup>) {
  await expect.poll(async () => (await f.app.inject(`/api/documents/${f.doc.id}/assistant`)).json().running).toBe(false);
  return (await f.app.inject(`/api/documents/${f.doc.id}/conversation`)).json().at(-1);
}
const imageBlock = (imageAttachments: unknown[]) => `\n\`\`\`json\n${JSON.stringify({ imageAttachments })}\n\`\`\``;

describe("assistant image actions", () => {
  it.each(["document", "game", "workshop"])("passes the actual source image to an edit in %s", async (mode) => {
    const f = setup();
    const reference = f.media.create(f.campaign.id, { ...png, name: "Оригинал.png" });
    f.setAnswer(imageBlock([{ documentId: f.doc.id, prompt: "Убери только надпись", referenceImageIds: [reference.id] }]));
    if (mode === "workshop") {
      await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Отредактируй изображение", imageIds: [reference.id] } });
    } else { await start(f, { ...(mode === "game" ? { mode: "game" } : {}), imageIds: [reference.id] }); await waitFinished(f); }
    expect(f.generated[0]).toMatchObject({ prompt: "Убери только надпись", images: [{ name: "Оригинал.png", dataUrl: png.dataUrl }] });
  });

  it("rejects foreign edit references before starting generation", async () => {
    const f = setup();
    const foreign = f.media.create(f.foreign.campaignId, png);
    f.setAnswer(imageBlock([{ documentId: f.doc.id, prompt: "Убери надпись", referenceImageIds: [foreign.id] }]));
    await start(f);
    const message = await waitFinished(f);
    expect(f.generated).toEqual([]);
    expect(message.meta.imageAttachments[0].error).toBeTruthy();
    expect(f.media.listForDocument(f.doc.id)).toEqual([]);
  });

  it.each([undefined, "game"])("generates and confirms avatars in %s mode while preserving document fences and game logs", async (mode) => {
    const f = setup();
    const prose = "Передаю запрос приложению.\n```doc\n## Новая история\nСмотритель\n```\n```edit-doc\nПравка\n```\n```json\n{\"example\":\"обычные данные\"}\n```";
    f.setAnswer(prose + imageBlock([{ documentId: f.doc.id, prompt: "Портрет смотрителя", setAsAvatar: true }]) + '\n```log\n{"title":"Осмотр маяка","important":true}\n```');
    expect((await start(f, { mode, meta: { actorKind: "pc", actorName: "Алдар" } })).statusCode).toBe(202);
    const message = await waitFinished(f);
    expect(message.content).toContain(prose);
    expect(message.content).not.toContain("imageAttachments");
    expect(message.meta.imageAttachments[0]).toMatchObject({ documentId: f.doc.id, image: { name: "Смотритель маяка — портрет.png" }, isAvatar: true });
    if (mode) expect(message.meta.log).toEqual({ title: "Осмотр маяка", important: true });
    expect(f.generated).toEqual([{ document: { title: "Смотритель маяка", type: "npc", text: "Сила 3. Пароль: ветер." }, prompt: "Портрет смотрителя" }]);
    const current = f.documents.get(f.doc.id)!;
    expect(current.fields).toEqual({ health: 7, avatarImageId: message.meta.imageAttachments[0].image.id });
    expect(current.contentJson).toEqual(f.doc.contentJson);
  });

  it("adds trusted current entities, galleries, avatars and chat image IDs without replacing the client prompt", async () => {
    const f = setup();
    const uploaded = f.media.create(f.campaign.id, png);
    f.media.attach(f.doc.id, uploaded.id);
    f.media.setAvatar(f.doc.id, uploaded.id);
    const currentImage = { ...uploaded, name: "Смотритель маяка — портрет.png" };
    await start(f, { system: "Мой текст документа и правила ```doc```", imageIds: [uploaded.id] });
    await waitFinished(f);
    const system = f.seen[0].system!;
    expect(system).toContain("Мой текст документа и правила ```doc```");
    const context = JSON.parse(system.split("Контекст изображений (JSON):\n").at(-1)!);
    expect(context.currentDocumentId).toBe(f.doc.id);
    expect(context.documents).toEqual([{ id: f.doc.id, type: "npc", title: "Смотритель маяка", images: [currentImage], avatar: currentImage }]);
    expect(context.chatImages).toEqual([currentImage]);
    expect(system).not.toContain(f.foreign.id);
    expect(system).not.toContain("data:image");
  });

  it("records a generator failure as a failed action without claiming an avatar", async () => {
    const f = setup({ async generate() { throw new Error("Codex не создал файл изображения"); } });
    f.setAnswer("Пробую создать портрет." + imageBlock([{ documentId: f.doc.id, prompt: "Портрет", setAsAvatar: true }]));
    await start(f);
    const message = await waitFinished(f);
    expect(message.meta.imageAttachments[0]).toMatchObject({ documentId: f.doc.id, error: expect.stringContaining("Codex не создал файл") });
    expect(message.meta.imageAttachments[0].image).toBeUndefined();
    expect(message.meta.imageAttachments[0].isAvatar).toBeUndefined();
    expect(f.media.listForDocument(f.doc.id)).toEqual([]);
    expect(f.documents.get(f.doc.id)!.fields).toEqual({ health: 7 });
  });

  it("keeps the assistant running through generation and cancels late imports and avatars on stop", async () => {
    let release!: (image: LlmImage) => void;
    let started = false;
    let signal: AbortSignal | undefined;
    const pending = new Promise<LlmImage>((resolve) => { release = resolve; });
    const f = setup({ async generate(_input, options) { started = true; signal = options?.signal; return pending; } });
    f.setAnswer("Создаю портрет." + imageBlock([{ documentId: f.doc.id, prompt: "Портрет", setAsAvatar: true }]));
    await start(f);
    try {
      await expect.poll(() => started).toBe(true);
      expect((await f.app.inject(`/api/documents/${f.doc.id}/assistant`)).json().running).toBe(true);
      expect((await start(f)).statusCode).toBe(409);
      expect((await f.app.inject({ method: "POST", url: `/api/documents/${f.doc.id}/assistant/stop` })).statusCode).toBe(204);
      expect(signal?.aborted).toBe(true);
    } finally { release(png); }
    const message = await waitFinished(f);
    expect(message.meta.imageAttachments[0].error).toContain("остановлено");
    expect(message.meta.imageAttachments[0].isAvatar).toBeUndefined();
    expect(f.media.listForDocument(f.doc.id)).toEqual([]);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
  });

  it("rejects foreign targets before generation and deleted targets after generation", async () => {
    let release!: (image: LlmImage) => void;
    let generating = false;
    const pending = new Promise<LlmImage>((resolve) => { release = resolve; });
    const f = setup({ async generate() { generating = true; return pending; } });
    const target = f.documents.create({ campaignId: f.campaign.id, type: "npc", title: "Пропавший" });
    f.setAnswer(imageBlock([{ documentId: f.foreign.id, prompt: "Чужая башня", setAsAvatar: true }, { documentId: target.id, prompt: "Портрет", setAsAvatar: true }]));
    await start(f);
    try { await expect.poll(() => generating).toBe(true); f.documents.delete(target.id); } finally { release(png); }
    const message = await waitFinished(f);
    expect(message.meta.imageAttachments).toHaveLength(2);
    expect(message.meta.imageAttachments.every((result: { error?: string; image?: unknown; isAvatar?: boolean }) => result.error && !result.image && !result.isAvatar)).toBe(true);
    expect(f.media.listForDocument(f.foreign.id)).toEqual([]);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 0 });
  });

  it("supports the same generated prompt source and avatar result in the workshop API", async () => {
    const f = setup();
    f.setAnswer("Передаю запрос." + imageBlock([{ documentId: f.doc.id, prompt: "Портрет", setAsAvatar: true }]));
    const response = await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm`, payload: { message: "Нарисуй портрет" } });
    expect(response.json().imageAttachments[0]).toMatchObject({ image: { name: "Смотритель маяка — портрет.png" }, isAvatar: true });
    expect(f.documents.get(f.doc.id)?.fields.avatarImageId).toBe(response.json().imageAttachments[0].image.id);
  });

  it("attaches an existing image as avatar without generating and deduplicates generated retries", async () => {
    const f = setup();
    const uploaded = f.media.create(f.campaign.id, { ...png, name: "Портрет смотрителя.png" });
    f.setAnswer(imageBlock([{ documentId: f.doc.id, imageId: uploaded.id, setAsAvatar: true }]));
    await start(f);
    const first = await waitFinished(f);
    expect(first.meta.imageAttachments[0]).toMatchObject({ image: { id: uploaded.id }, isAvatar: true });
    expect(f.generated).toEqual([]);
    f.setAnswer(imageBlock([{ documentId: f.doc.id, prompt: "Тот же портрет", setAsAvatar: true }]));
    await start(f);
    const second = await waitFinished(f);
    expect(second.meta.imageAttachments[0]).toMatchObject({ image: { id: uploaded.id }, isAvatar: true });
    expect(f.media.listForDocument(f.doc.id)).toHaveLength(1);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 1 });
  });

  it("retains a successful attachment when avatar assignment fails", async () => {
    const f = setup();
    const uploaded = f.media.create(f.campaign.id, png);
    const service = new WorkshopImageService(f.documents, f.media);
    vi.spyOn(f.media, "setAvatar").mockImplementation(() => { throw new MediaError("Не удалось назначить аватар"); });
    const [result] = await service.attach(f.campaign.id, [{ documentId: f.doc.id, imageId: uploaded.id, setAsAvatar: true }]);
    expect(result).toMatchObject({ image: { id: uploaded.id }, error: "Не удалось назначить аватар" });
    expect(result.isAvatar).toBeUndefined();
    expect(f.media.listForDocument(f.doc.id)).toEqual([result.image]);
    expect(f.documents.get(f.doc.id)!.fields).toEqual({ health: 7 });
  });
});
