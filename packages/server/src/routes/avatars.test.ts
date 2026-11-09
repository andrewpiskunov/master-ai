import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDb } from "../db/client.js";
import { buildApp } from "../app.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=";
const opened: { app: ReturnType<typeof buildApp>; sqlite: ReturnType<typeof createDb>["sqlite"] }[] = [];
function setup() {
  const { db, sqlite } = createDb(":memory:");
  const app = buildApp({ db, llm: { async *complete() { yield "Ответ"; } } });
  const fixture = { app, sqlite };
  opened.push(fixture);
  return fixture;
}
afterEach(async () => {
  for (const { app, sqlite } of opened.splice(0)) { await app.close(); sqlite.close(); }
});
type App = ReturnType<typeof setup>["app"];
async function campaign(app: App) {
  return (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Портреты" } })).json();
}
async function document(app: App, campaignId: string, type = "npc") {
  const res = await app.inject({ method: "POST", url: "/api/documents", payload: {
    campaignId, type, title: "Карточка", status: type === "npc" ? "active" : type === "scene" ? "planned" : null,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Текст мастера" }] }] },
    fields: { tags: ["тест"], contentUpdatedAt: "2026-01-01T00:00:00.000Z", custom: { value: 7 } },
  } });
  expect(res.statusCode).toBe(201);
  return res.json();
}
async function upload(app: App, campaignId: string, name: string) {
  return (await app.inject({ method: "POST", url: `/api/campaigns/${campaignId}/images`, payload: { name, dataUrl: png } })).json();
}
async function attach(app: App, documentId: string, imageId: string) {
  return app.inject({ method: "POST", url: `/api/documents/${documentId}/images`, payload: { imageId } });
}
async function get(app: App, documentId: string) {
  return (await app.inject({ method: "GET", url: `/api/documents/${documentId}` })).json();
}
async function select(app: App, documentId: string, imageId: string | null) {
  return app.inject({ method: "PUT", url: `/api/documents/${documentId}/avatar`, payload: { imageId } });
}

describe("entity avatars", () => {
  it("resolves existing gallery images for every entity type in reads and lists without exposing bytes", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app);
    for (const type of ["npc", "location", "item", "scene"]) {
      const d = await document(app, c.id, type);
      expect(d.avatar).toBeNull();
      const first = await upload(app, c.id, `${type}-first.png`);
      const second = await upload(app, c.id, `${type}-second.png`);
      sqlite.prepare("UPDATE images SET created_at = ? WHERE id = ?").run("2026-01-01", first.id);
      sqlite.prepare("UPDATE images SET created_at = ? WHERE id = ?").run("2026-01-02", second.id);
      await attach(app, d.id, second.id); await attach(app, d.id, first.id);
      expect((await get(app, d.id)).avatar).toEqual(first);
    }
    const list = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` });
    expect(list.json().every((d: { avatar: unknown }) => d.avatar)).toBe(true);
    expect(list.body).not.toContain("data:image");
    expect(list.body).not.toContain("dataUrl");
  });

  it("selects and resets an avatar while preserving content, status and unrelated fields", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app); const d = await document(app, c.id);
    const first = await upload(app, c.id, "first.png"); const chosen = await upload(app, c.id, "chosen.png");
    sqlite.prepare("UPDATE images SET created_at = ? WHERE id = ?").run("2026-01-01", first.id);
    await attach(app, d.id, first.id); await attach(app, d.id, chosen.id);
    const selected = await select(app, d.id, chosen.id);
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({ avatar: chosen, contentJson: d.contentJson, title: d.title, status: d.status,
      fields: { ...d.fields, avatarImageId: chosen.id } });
    expect((await get(app, d.id)).avatar).toEqual(chosen);
    const reset = await select(app, d.id, null);
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ avatar: first, contentJson: d.contentJson, fields: d.fields });
    expect(reset.json().fields).not.toHaveProperty("avatarImageId");
  });

  it("rejects unattached, foreign, missing and malformed selections without changing fields", async () => {
    const { app } = setup(); const c = await campaign(app); const other = await campaign(app); const d = await document(app, c.id);
    const unattached = await upload(app, c.id, "unattached.png"); const foreign = await upload(app, other.id, "foreign.png");
    for (const imageId of [unattached.id, foreign.id, randomUUID(), "bad"]) {
      expect((await select(app, d.id, imageId)).statusCode).toBe(400);
      expect((await get(app, d.id)).fields).toEqual(d.fields);
    }
    expect((await select(app, randomUUID(), null)).statusCode).toBe(404);
  });

  it("keeps an avatar selection when a concurrent tag or content update sends older fields", async () => {
    const { app } = setup(); const c = await campaign(app); const d = await document(app, c.id);
    const a = await upload(app, c.id, "a.png"); const b = await upload(app, c.id, "b.png");
    await attach(app, d.id, a.id); await attach(app, d.id, b.id); await select(app, d.id, b.id);
    const tagged = await app.inject({ method: "PATCH", url: `/api/documents/${d.id}`, payload: { fields: { ...d.fields, tags: ["новый"] } } });
    expect(tagged.json()).toMatchObject({ avatar: b, fields: { avatarImageId: b.id, tags: ["новый"] } });
    const edited = await app.inject({ method: "PATCH", url: `/api/documents/${d.id}`, payload: {
      contentJson: { type: "doc", content: [] }, fields: { ...d.fields, avatarImageId: a.id },
    } });
    expect(edited.json()).toMatchObject({ avatar: b, fields: { avatarImageId: b.id } });
  });

  it("ignores forged fields and foreign gallery links when resolving an avatar", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app); const other = await campaign(app); const d = await document(app, c.id);
    const local = await upload(app, c.id, "local.png"); const foreign = await upload(app, other.id, "foreign.png");
    await attach(app, d.id, local.id);
    sqlite.prepare("INSERT INTO document_images (document_id, image_id) VALUES (?, ?)").run(d.id, foreign.id);
    sqlite.prepare("UPDATE documents SET fields = ? WHERE id = ?").run(JSON.stringify({ ...d.fields, avatarImageId: foreign.id }), d.id);
    expect((await get(app, d.id)).avatar).toEqual(local);
    const list = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` })).json();
    expect(list[0].avatar).toEqual(local);
  });

  it("clears a detached selection and falls back to a remaining image or placeholder", async () => {
    const { app } = setup(); const c = await campaign(app); const d = await document(app, c.id);
    const a = await upload(app, c.id, "a.png"); const b = await upload(app, c.id, "b.png");
    await attach(app, d.id, a.id); await attach(app, d.id, b.id); await select(app, d.id, b.id);
    await app.inject({ method: "DELETE", url: `/api/documents/${d.id}/images/${b.id}` });
    expect(await get(app, d.id)).toMatchObject({ avatar: a, fields: d.fields, contentJson: d.contentJson });
    expect((await get(app, d.id)).fields).not.toHaveProperty("avatarImageId");
    await app.inject({ method: "DELETE", url: `/api/documents/${d.id}/images/${a.id}` });
    expect((await get(app, d.id)).avatar).toBeNull();
  });

  it("remaps an explicitly selected avatar during export/import", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app); const d = await document(app, c.id);
    const a = await upload(app, c.id, "a.png"); const b = await upload(app, c.id, "b.png");
    await attach(app, d.id, a.id); await attach(app, d.id, b.id);
    sqlite.prepare("UPDATE images SET created_at = ? WHERE id = ?").run("2026-01-01", a.id);
    await select(app, d.id, b.id);
    const data = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/export-json` })).json();
    const imported = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: data });
    expect(imported.statusCode).toBe(201);
    const docs = (await app.inject({ method: "GET", url: `/api/campaigns/${imported.json().id}/documents` })).json();
    expect(docs[0].avatar).toMatchObject({ name: "b.png", mimeType: "image/png" });
    expect(docs[0].avatar.id).not.toBe(b.id);
    expect(docs[0].fields).toEqual({ ...d.fields, avatarImageId: docs[0].avatar.id });
    expect(docs[0].contentJson).toEqual(d.contentJson);
  });
});
