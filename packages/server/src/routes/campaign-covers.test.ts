import { afterEach, describe, expect, it, vi } from "vitest";
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
async function campaign(app: App, name = "Библиотека") {
  const res = await app.inject({ method: "POST", url: "/api/campaigns", payload: { name, system: "Fate", description: "Текст мастера" } });
  expect(res.statusCode).toBe(201);
  return res.json();
}
async function upload(app: App, campaignId: string, name: string) {
  const res = await app.inject({ method: "POST", url: `/api/campaigns/${campaignId}/images`, payload: { name, dataUrl: png } });
  expect(res.statusCode).toBe(201);
  return res.json();
}
const get = (app: App, id: string) => app.inject({ method: "GET", url: `/api/campaigns/${id}` });
const select = (app: App, id: string, imageId: string | null) => app.inject({ method: "PUT", url: `/api/campaigns/${id}/cover`, payload: { imageId } });

describe("campaign library covers", () => {
  it("starts with an explicit placeholder and never picks an uploaded image automatically", async () => {
    const { app } = setup(); const c = await campaign(app);
    expect(c.cover).toBeNull();
    expect(c.updatedAt).toBe(c.createdAt);
    await upload(app, c.id, "NPC.png");
    expect((await get(app, c.id)).json().cover).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/campaigns" })).json()[0].cover).toBeNull();
  });

  it("lists only campaign-owned image metadata for the picker", async () => {
    const { app } = setup(); const c = await campaign(app); const other = await campaign(app);
    const local = await upload(app, c.id, "Обложка.png");
    await upload(app, other.id, "Чужая.png");
    const response = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/images` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([local]);
    expect(response.body).not.toContain("dataUrl");
    expect((await app.inject({ method: "GET", url: `/api/campaigns/${randomUUID()}/images` })).statusCode).toBe(404);
  });

  it("persists a selected cover in detail and list responses, then clears to the placeholder", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app);
    await upload(app, c.id, "Первая.png"); const chosen = await upload(app, c.id, "Выбранная.png");
    // A later update must be visible even when the original campaign is old.
    sqlite.prepare("UPDATE campaigns SET created_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", c.id);
    const selected = await select(app, c.id, chosen.id);
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({ name: c.name, system: c.system, description: c.description, cover: chosen });
    expect(selected.json().updatedAt > "2020-01-01T00:00:00.000Z").toBe(true);
    expect((await get(app, c.id)).json().cover).toEqual(chosen);
    const listed = await app.inject({ method: "GET", url: "/api/campaigns" });
    expect(listed.json()[0].cover).toEqual(chosen);
    expect(listed.body).not.toContain("dataUrl");
    expect(listed.json()[0]).not.toHaveProperty("coverImageId");
    const patched = await app.inject({ method: "PATCH", url: `/api/campaigns/${c.id}`, payload: { name: "Новое имя" } });
    expect(patched.json().cover).toEqual(chosen);
    expect((await select(app, c.id, null)).json().cover).toBeNull();
    expect((await get(app, c.id)).json().cover).toBeNull();
  });

  it("rejects foreign, missing and malformed selections without replacing the cover", async () => {
    const { app } = setup(); const c = await campaign(app); const other = await campaign(app);
    const local = await upload(app, c.id, "Моя.png"); const foreign = await upload(app, other.id, "Чужая.png");
    expect((await select(app, c.id, local.id)).statusCode).toBe(200);
    for (const imageId of [foreign.id, randomUUID(), "bad"]) {
      expect((await select(app, c.id, imageId)).statusCode).toBe(400);
      expect((await get(app, c.id)).json().cover).toEqual(local);
    }
    expect((await app.inject({ method: "PUT", url: `/api/campaigns/${c.id}/cover`, payload: {} })).statusCode).toBe(400);
    expect((await select(app, randomUUID(), null)).statusCode).toBe(404);
  });

  it("ignores a stale or foreign stored cover pointer", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app); const other = await campaign(app);
    const foreign = await upload(app, other.id, "Чужая.png");
    for (const imageId of [foreign.id, randomUUID()]) {
      sqlite.prepare("UPDATE campaigns SET cover_image_id = ? WHERE id = ?").run(imageId, c.id);
      expect((await get(app, c.id)).json().cover).toBeNull();
      const list = (await app.inject({ method: "GET", url: "/api/campaigns" })).json();
      expect(list.find((row: { id: string }) => row.id === c.id).cover).toBeNull();
    }
  });

  it("keeps catalogue queries bounded and never selects image bytes or document bodies", async () => {
    const { app, sqlite } = setup(); let firstId = "";
    for (let n = 0; n < 8; n++) {
      const c = await campaign(app, `Кампания ${n}`); firstId ||= c.id;
      const image = await upload(app, c.id, "Обложка.png"); await select(app, c.id, image.id);
    }
    const prepare = vi.spyOn(sqlite, "prepare");
    try {
      const listed = await app.inject({ method: "GET", url: "/api/campaigns" });
      expect(listed.json()).toHaveLength(8);
      // Bound database work independently of the number of campaigns.
      expect(prepare.mock.calls).toHaveLength(1);
      await get(app, firstId);
      const picker = await app.inject({ method: "GET", url: `/api/campaigns/${firstId}/images` });
      await select(app, firstId, picker.json()[0].id);
      for (const [query] of prepare.mock.calls) {
        expect(query).not.toMatch(/data_url|content_json|select\s+\*/i);
      }
    } finally { prepare.mockRestore(); }
  });

  it("uses the latest document or campaign metadata date for activity", async () => {
    const { app, sqlite } = setup(); const c = await campaign(app); const other = await campaign(app);
    const d = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "note", title: "Заметка" } })).json();
    sqlite.prepare("UPDATE campaigns SET updated_at = ?").run("2020-01-01T00:00:00.000Z");
    sqlite.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run("2024-07-01T00:00:00.000Z", d.id);
    expect((await get(app, c.id)).json().updatedAt).toBe("2024-07-01T00:00:00.000Z");
    const list = (await app.inject({ method: "GET", url: "/api/campaigns" })).json();
    expect(list.find((row: { id: string }) => row.id === c.id).updatedAt).toBe("2024-07-01T00:00:00.000Z");
    expect(list.find((row: { id: string }) => row.id === other.id).updatedAt).toBe("2020-01-01T00:00:00.000Z");
    const updated = await app.inject({ method: "PATCH", url: `/api/campaigns/${c.id}`, payload: { description: "Свежий текст" } });
    expect(updated.json().updatedAt > "2024-07-01T00:00:00.000Z").toBe(true);
  });

  it("exports and remaps the chosen cover while retaining legacy v1 imports", async () => {
    const { app } = setup(); const c = await campaign(app);
    await upload(app, c.id, "NPC.png"); const chosen = await upload(app, c.id, "Кампания.png");
    await select(app, c.id, chosen.id);
    const exported = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/export-json` })).json();
    expect(exported.campaign.cover).toEqual(chosen);
    expect(exported.campaign.updatedAt).toEqual(expect.any(String));
    const imported = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: exported });
    expect(imported.statusCode).toBe(201);
    const result = imported.json();
    expect(result.cover).toMatchObject({ name: "Кампания.png", mimeType: "image/png" });
    expect(result.cover.id).not.toBe(chosen.id);
    expect((await get(app, result.id)).json().cover).toEqual(result.cover);
    expect((await app.inject({ method: "GET", url: `/api/images/${result.cover.id}` })).statusCode).toBe(200);
    delete exported.campaign.cover; delete exported.campaign.updatedAt;
    const legacy = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: exported });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json().cover).toBeNull();
    expect(legacy.json().updatedAt >= legacy.json().createdAt).toBe(true);
  });

  it("rejects an imported cover outside the exported images atomically", async () => {
    const { app } = setup(); const c = await campaign(app);
    const image = await upload(app, c.id, "Кампания.png"); await select(app, c.id, image.id);
    const exported = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/export-json` })).json();
    exported.campaign.cover = { ...image, id: randomUUID() };
    const imported = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: exported });
    expect(imported.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/campaigns" })).json()).toHaveLength(1);
  });
});
