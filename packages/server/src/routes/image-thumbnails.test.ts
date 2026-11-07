import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";
import sharp from "sharp";
import { createDb } from "../db/client.js";
import { buildApp } from "../app.js";
import { MediaService } from "../services/media.js";
import { CampaignService } from "../services/campaigns.js";

type Fixture = ReturnType<typeof createDb> & { app: ReturnType<typeof buildApp>; queries: string[] };
const opened: Fixture[] = [];
const folders: string[] = [];
function make(path = ":memory:"): Fixture {
  const { sqlite } = createDb(path);
  const queries: string[] = [];
  const db = drizzle(sqlite, { logger: { logQuery(query) { queries.push(query); } } });
  const app = buildApp({ db, llm: { async *complete() { yield "Ответ"; } } });
  const fixture = { app, sqlite, db, queries };
  opened.push(fixture);
  return fixture;
}
async function close(fixture: ReturnType<typeof make>) {
  await fixture.app.close();
  fixture.sqlite.close();
  opened.splice(opened.indexOf(fixture), 1);
}
afterEach(async () => {
  for (const fixture of [...opened]) await close(fixture);
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
async function fixtureImage(fixture: ReturnType<typeof make>, bytes: Buffer, mimeType = "image/png") {
  const c = (await fixture.app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Миниатюры" } })).json();
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const res = await fixture.app.inject({ method: "POST", url: `/api/campaigns/${c.id}/images`, payload: { name: "карта", dataUrl } });
  expect(res.statusCode).toBe(201);
  return { campaignId: c.id as string, imageId: res.json().id as string, dataUrl };
}
const png = (width = 1600, height = 800) => sharp({ create: { width, height, channels: 4, background: "#3974ad80" } }).png().toBuffer();
const thumbnail = (imageId: string, query = "") => `/api/images/${imageId}/thumbnail${query}`;

describe("image thumbnail API", () => {
  it.each([
    ["?size=128", 128, 64], ["", 256, 128], ["?size=256", 256, 128],
    ["?size=512", 512, 256], ["?size=1024", 1024, 512],
  ])("serves a WebP fitting the requested bounds %s", async (query, width, height) => {
    const fixture = make(); const image = await fixtureImage(fixture, await png());
    const res = await fixture.app.inject(thumbnail(image.imageId, query));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers.etag).toMatch(/^"[^"]+"$/);
    expect(await sharp(res.rawPayload).metadata()).toMatchObject({ format: "webp", width, height, hasAlpha: true });
  });

  it("does not upscale a small source", async () => {
    const fixture = make(); const image = await fixtureImage(fixture, await png(31, 17));
    const res = await fixture.app.inject(thumbnail(image.imageId, "?size=128"));
    expect(res.statusCode).toBe(200);
    expect(await sharp(res.rawPayload).metadata()).toMatchObject({ width: 31, height: 17 });
  });

  it("applies EXIF orientation before fitting without changing the original", async () => {
    const fixture = make();
    const bytes = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#ab1234" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const image = await fixtureImage(fixture, bytes, "image/jpeg");
    const res = await fixture.app.inject(thumbnail(image.imageId, "?size=128"));
    expect(res.statusCode).toBe(200);
    expect(await sharp(res.rawPayload).metadata()).toMatchObject({ width: 64, height: 128 });
    expect((await fixture.app.inject(`/api/images/${image.imageId}`)).rawPayload).toEqual(bytes);
  });

  it.each(["0", "127", "129", "2048", "-128", "128.0", "1e2", "hello", "", "128&size=256"])("rejects invalid size %s", async (size) => {
    const fixture = make(); const image = await fixtureImage(fixture, await png(2, 2));
    const res = await fixture.app.inject(thumbnail(image.imageId, `?size=${size}`));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
  });

  it("returns 404 for a missing image", async () => {
    const fixture = make();
    expect((await fixture.app.inject(thumbnail(randomUUID()))).statusCode).toBe(404);
  });

  it("returns a clear 422 for corrupt data and leaves the original accessible", async () => {
    const fixture = make(); const bytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const image = await fixtureImage(fixture, bytes);
    const res = await fixture.app.inject(thumbnail(image.imageId));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/изображен/i);
    expect((await fixture.app.inject(`/api/images/${image.imageId}`)).rawPayload).toEqual(bytes);
  });

  it("bounds input pixels before decoding a compressed large image", async () => {
    const fixture = make(); const bytes = await png(6400, 6400);
    const image = await fixtureImage(fixture, bytes);
    const res = await fixture.app.inject(thumbnail(image.imageId));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/изображен/i);
  });

  it("persists WebP bytes across app restarts and serves hits without reading original data", async () => {
    const folder = mkdtempSync(join(tmpdir(), "master-ai-thumbnails-")); folders.push(folder);
    const path = join(folder, "images.sqlite");
    const first = make(path); const image = await fixtureImage(first, await png());
    const generated = await first.app.inject(thumbnail(image.imageId, "?size=128"));
    expect(generated.statusCode).toBe(200);
    expect(first.sqlite.prepare("SELECT typeof(data) AS kind FROM image_thumbnails").get()).toEqual({ kind: "blob" });
    await close(first);
    const restarted = make(path); restarted.queries.length = 0;
    const hit = await restarted.app.inject(thumbnail(image.imageId, "?size=128"));
    expect(hit.statusCode).toBe(200);
    expect(hit.rawPayload).toEqual(generated.rawPayload);
    expect(hit.headers.etag).toBe(generated.headers.etag);
    expect(restarted.queries.filter((query) => query.includes('"data_url"'))).toEqual([]);
    restarted.sqlite.prepare("DELETE FROM image_thumbnails").run();
    const regenerated = await restarted.app.inject(thumbnail(image.imageId, "?size=128"));
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.rawPayload).toEqual(generated.rawPayload);
  });

  it("ignores cache entries from a different rendering version", async () => {
    const fixture = make(); const image = await fixtureImage(fixture, await png());
    fixture.sqlite.prepare("INSERT INTO image_thumbnails (image_id, size, version, data, etag) VALUES (?, ?, ?, ?, ?)")
      .run(image.imageId, 128, "old-renderer", Buffer.from("stale"), '"old"');
    const res = await fixture.app.inject(thumbnail(image.imageId, "?size=128"));
    expect(res.statusCode).toBe(200);
    expect(await sharp(res.rawPayload).metadata()).toMatchObject({ format: "webp", width: 128, height: 64 });
    expect(res.headers.etag).not.toBe('"old"');
  });

  it("deduplicates simultaneous requests for the same uncached variant", async () => {
    const fixture = make(); const image = await fixtureImage(fixture, await png());
    fixture.queries.length = 0;
    const responses = await Promise.all(Array.from({ length: 8 }, () => fixture.app.inject(thumbnail(image.imageId, "?size=128"))));
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(responses[0].rawPayload);
    }
    expect(fixture.queries.filter((query) => query.startsWith("select") && query.includes('"data_url"'))).toHaveLength(1);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM image_thumbnails").get()).toEqual({ n: 1 });
  });

  it("retries a failed transform instead of retaining a rejected in-flight request", async () => {
    const fixture = make(); const image = await fixtureImage(fixture, Buffer.from("89504e470d0a1a0a00000000", "hex"));
    expect((await fixture.app.inject(thumbnail(image.imageId))).statusCode).toBe(422);
    fixture.sqlite.prepare("UPDATE images SET data_url = ? WHERE id = ?").run(`data:image/png;base64,${(await png(20, 10)).toString("base64")}`, image.imageId);
    const retried = await fixture.app.inject(thumbnail(image.imageId));
    expect(retried.statusCode).toBe(200);
    expect(await sharp(retried.rawPayload).metadata()).toMatchObject({ width: 20, height: 10 });
  });

  it("returns 304 with no body for matching original and thumbnail validators", async () => {
    const fixture = make(); const bytes = await png(); const image = await fixtureImage(fixture, bytes);
    for (const url of [`/api/images/${image.imageId}`, thumbnail(image.imageId, "?size=128")]) {
      const first = await fixture.app.inject(url);
      expect(first.statusCode).toBe(200);
      expect(first.headers["cache-control"]).toContain("private");
      expect(first.headers.etag).toMatch(/^"[^"]+"$/);
      const conditional = await fixture.app.inject({ url, headers: { "if-none-match": `"other", W/${first.headers.etag}` } });
      expect(conditional.statusCode).toBe(304);
      expect(conditional.rawPayload).toHaveLength(0);
      expect(conditional.headers.etag).toBe(first.headers.etag);
      const miss = await fixture.app.inject({ url, headers: { "if-none-match": '"unrelated"' } });
      expect(miss.statusCode).toBe(200);
      if (url === `/api/images/${image.imageId}`) expect(miss.rawPayload).toEqual(bytes);
    }
  });

  it("cleans variants on campaign deletion and excludes derivatives from transfer", async () => {
    const fixture = make(); const image = await fixtureImage(fixture, await png());
    const other = await fixtureImage(fixture, await png(20, 10));
    for (const id of [image.imageId, other.imageId]) expect((await fixture.app.inject(thumbnail(id))).statusCode).toBe(200);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM image_thumbnails").get()).toEqual({ n: 2 });
    const data = (await fixture.app.inject(`/api/campaigns/${image.campaignId}/export-json`)).json();
    expect(data.images[0].dataUrl).toBe(image.dataUrl);
    expect(Object.keys(data)).not.toContain("imageThumbnails");
    expect(Object.keys(data)).not.toContain("image_thumbnails");
    const imported = await fixture.app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: data });
    expect(imported.statusCode).toBe(201);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM image_thumbnails").get()).toEqual({ n: 2 });
    expect((await fixture.app.inject({ method: "DELETE", url: `/api/campaigns/${image.campaignId}` })).statusCode).toBe(204);
    expect(fixture.sqlite.prepare("SELECT image_id FROM image_thumbnails").all()).toEqual([{ image_id: other.imageId }]);
    expect((await fixture.app.inject(thumbnail(image.imageId))).statusCode).toBe(404);
  });

  it("does not resurrect derivatives if the campaign is deleted while resizing", async () => {
    const fixture = make(); const image = await fixtureImage(fixture, await png());
    const media = new MediaService(fixture.db);
    const pending = media.getThumbnail(image.imageId, 128);
    new CampaignService(fixture.db).delete(image.campaignId);
    expect(await pending).toBeUndefined();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM image_thumbnails").get()).toEqual({ n: 0 });
  });
});
