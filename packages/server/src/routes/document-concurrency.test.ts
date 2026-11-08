import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { DocumentService } from "../services/documents.js";
import { MediaService } from "../services/media.js";
import { textToDoc } from "../services/proposals.js";

const opened: { app: ReturnType<typeof buildApp>; sqlite: ReturnType<typeof createDb>["sqlite"] }[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const f of opened.splice(0)) { await f.app.close(); f.sqlite.close(); } });

function setup() {
  const { db, sqlite } = createDb(":memory:");
  const campaign = new CampaignService(db).create({ name: "Тест" });
  const documents = new DocumentService(db);
  const media = new MediaService(db);
  const doc = documents.create({ campaignId: campaign.id, type: "npc", title: "Барон", status: "active", contentJson: textToDoc("OLD_TEXT"), fields: { strength: 3, tags: ["Совет"] } });
  const app = buildApp({ db, llm: { async *complete() { yield "Ответ"; } } });
  opened.push({ app, sqlite });
  const patch = (id: string, payload: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/api/documents/${id}`, payload });
  return { db, sqlite, campaign, documents, media, doc, patch };
}

describe("conditional document edits", () => {
  it("returns 409 for a stale version without modifying the card or search index", async () => {
    const f = setup();
    const latest = f.documents.update(f.doc.id, { title: "Мастерская правка", contentJson: textToDoc("CURRENT_TEXT"), fields: { strength: 5 } })!;
    const beforeIndex = f.sqlite.prepare("SELECT rowid, * FROM documents_fts WHERE doc_id = ?").all(f.doc.id);
    const response = await f.patch(f.doc.id, { expectedUpdatedAt: f.doc.updatedAt, title: "Устаревшая правка", contentJson: textToDoc("STALE_TEXT"), fields: { strength: 1 }, status: "deceased" });
    expect(response.statusCode).toBe(409);
    expect(f.documents.get(f.doc.id)).toEqual(latest);
    expect(f.sqlite.prepare("SELECT rowid, * FROM documents_fts WHERE doc_id = ?").all(f.doc.id)).toEqual(beforeIndex);
  });

  it("applies a fresh content edit while retaining status, fields and the selected avatar", async () => {
    const f = setup();
    const image = f.media.create(f.campaign.id, { name: "Барон.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=" });
    f.media.attach(f.doc.id, image.id);
    f.media.setAvatar(f.doc.id, image.id);
    const before = f.documents.get(f.doc.id)!;
    const response = await f.patch(f.doc.id, { expectedUpdatedAt: before.updatedAt, contentJson: textToDoc("UPDATED_TEXT"), title: "Барон после встречи" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ title: "Барон после встречи", contentJson: textToDoc("UPDATED_TEXT"), status: "active", fields: { strength: 3, tags: ["Совет"], avatarImageId: image.id }, avatar: { id: image.id } });
    expect(response.json().updatedAt > before.updatedAt).toBe(true);
    expect(f.sqlite.prepare("SELECT body FROM documents_fts WHERE doc_id = ?").get(f.doc.id)).toEqual({ body: "UPDATED_TEXT" });
  });

  it("advances the version for same-millisecond edits and rejects reuse of the old version", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
    const f = setup();
    const first = await f.patch(f.doc.id, { expectedUpdatedAt: f.doc.updatedAt, title: "Первая правка" });
    expect(first.statusCode).toBe(200);
    expect(first.json().updatedAt).toBe("2026-11-08T12:00:00.001Z");
    const stale = await f.patch(f.doc.id, { expectedUpdatedAt: f.doc.updatedAt, title: "Потерянная правка" });
    expect(stale.statusCode).toBe(409);
    const fresh = await f.patch(f.doc.id, { expectedUpdatedAt: first.json().updatedAt, title: "Вторая правка" });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().updatedAt).toBe("2026-11-08T12:00:00.002Z");
    expect(f.documents.get(f.doc.id)!.title).toBe("Вторая правка");
  });

  it.each(["x", ""])("recovers invalid legacy version %j for content and avatar edits", async (legacyVersion) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
    const f = setup();
    f.sqlite.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(legacyVersion, f.doc.id);
    const edited = await f.patch(f.doc.id, { expectedUpdatedAt: legacyVersion, contentJson: textToDoc("RECOVERED_TEXT") });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().updatedAt).toBe("2026-11-08T12:00:00.000Z");
    expect((await f.patch(f.doc.id, { expectedUpdatedAt: legacyVersion, title: "Устаревшая версия" })).statusCode).toBe(409);

    const image = f.media.create(f.campaign.id, { name: "Барон.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=" });
    f.media.attach(f.doc.id, image.id);
    f.sqlite.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(legacyVersion, f.doc.id);
    f.media.setAvatar(f.doc.id, image.id);
    expect(f.documents.get(f.doc.id)).toMatchObject({ updatedAt: "2026-11-08T12:00:00.000Z", avatar: { id: image.id } });
  });

  it("keeps unconditional edits compatible and returns 404 for deleted or absent documents", async () => {
    const f = setup();
    expect((await f.patch(f.doc.id, { title: "Обычная правка" })).statusCode).toBe(200);
    f.documents.delete(f.doc.id);
    expect((await f.patch(f.doc.id, { expectedUpdatedAt: f.doc.updatedAt, title: "Поздняя правка" })).statusCode).toBe(404);
    expect((await f.patch("missing", { expectedUpdatedAt: f.doc.updatedAt, title: "Правка" })).statusCode).toBe(404);
  });

  it("checks the version atomically if another writer updates after the initial read", () => {
    const f = setup();
    const otherWriter = new DocumentService(f.db);
    const realGet = f.documents.get.bind(f.documents);
    vi.spyOn(f.documents, "get").mockImplementationOnce((id) => {
      const before = realGet(id);
      otherWriter.update(id, { title: "Конкурирующая правка", contentJson: textToDoc("CONCURRENT_TEXT") });
      return before;
    });
    expect(() => f.documents.update(f.doc.id, { title: "Устаревшая правка" }, f.doc.updatedAt)).toThrow();
    expect(realGet(f.doc.id)!.title).toBe("Конкурирующая правка");
    expect(f.sqlite.prepare("SELECT title, body FROM documents_fts WHERE doc_id = ?").get(f.doc.id)).toEqual({ title: "Конкурирующая правка", body: "CONCURRENT_TEXT" });
  });

  it("advances avatar versions without collision or rollback before accepting a reviewed edit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T12:00:00.000Z"));
    const f = setup();
    const image = f.media.create(f.campaign.id, { name: "Барон.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=" });
    f.media.attach(f.doc.id, image.id);
    const before = f.documents.update(f.doc.id, { title: "До выбора аватара" })!;
    f.media.setAvatar(f.doc.id, image.id);
    const afterAvatar = f.documents.get(f.doc.id)!;
    expect(afterAvatar.updatedAt > before.updatedAt).toBe(true);
    expect((await f.patch(f.doc.id, { expectedUpdatedAt: before.updatedAt, title: "Устарело" })).statusCode).toBe(409);
    f.media.setAvatar(f.doc.id, null);
    const afterClear = f.documents.get(f.doc.id)!;
    expect(afterClear.updatedAt > afterAvatar.updatedAt).toBe(true);
    f.media.setAvatar(f.doc.id, image.id);
    const beforeDelete = f.documents.get(f.doc.id)!;
    f.media.delete(image.id);
    expect(f.documents.get(f.doc.id)!.updatedAt > beforeDelete.updatedAt).toBe(true);
    expect((await f.patch(f.doc.id, { expectedUpdatedAt: beforeDelete.updatedAt, title: "Устарело после удаления" })).statusCode).toBe(409);
  });
});
