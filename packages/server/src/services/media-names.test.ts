import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db/client.js";
import { CampaignService } from "./campaigns.js";
import { DocumentService } from "./documents.js";
import { MediaService } from "./media.js";
import { ConversationService } from "./conversations.js";
import { TransferService } from "./transfer.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=";
const technical = "exec-13ad6605-4bb6-4678-82b6-dcc9dca5511b.png";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
function setup(path = ":memory:") {
  const { db, sqlite } = createDb(path);
  cleanups.push(() => { if (sqlite.open) sqlite.close(); });
  const campaigns = new CampaignService(db);
  const documents = new DocumentService(db);
  const media = new MediaService(db);
  const conversations = new ConversationService(db);
  const campaign = campaigns.create({ name: "Портреты" });
  const doc = documents.create({ campaignId: campaign.id, type: "npc", title: "Олдос Суини", contentJson: { type: "doc", content: [] }, fields: { health: 7 } });
  return { db, sqlite, campaigns, campaign, documents, doc, media, conversations };
}

describe("readable image filenames", () => {
  it("names generated imports after the current entity and retains deduplicated bytes and IDs", () => {
    const f = setup();
    const image = f.media.importForDocument(f.doc.id, { name: technical, dataUrl: png });
    expect(image.name).toBe("Олдос Суини — портрет.png");
    expect(f.media.importForDocument(f.doc.id, { name: "illustration.png", dataUrl: png })).toEqual(image);
    expect(f.media.get(image.id)?.dataUrl).toBe(png);
    expect(f.media.listForDocument(f.doc.id)).toEqual([image]);
    expect(f.documents.get(f.doc.id)).toMatchObject({ title: "Олдос Суини", contentJson: f.doc.contentJson, fields: f.doc.fields });
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM images").get()).toEqual({ n: 1 });
  });

  it("uses safe bounded filenames and the actual MIME extension for each entity kind", () => {
    const f = setup();
    const location = f.documents.create({ campaignId: f.campaign.id, type: "location", title: "Крутые бобы" });
    const jpeg = "data:image/jpeg;base64,/9j/AA==";
    expect(f.media.importForDocument(location.id, { name: "wrong.png", dataUrl: jpeg }).name).toBe("Крутые бобы — иллюстрация.jpg");
    const unsafe = f.documents.create({ campaignId: f.campaign.id, type: "pc", title: '../Пилот\\<>:"|?*\u0001\r\n' + "д".repeat(250) });
    const image = f.media.importForDocument(unsafe.id, { name: technical, dataUrl: png });
    expect(image.name.length).toBeLessThanOrEqual(200);
    expect(image.name).toMatch(/ — портрет\.png$/);
    expect(image.name).not.toMatch(/[\\/<>:"|?*\u0000-\u001f\u007f]/);
    expect(image.name).not.toMatch(/^\./);
    expect(f.documents.get(unsafe.id)?.title).toBe(unsafe.title);
  });

  it("preserves descriptive uploaded names when attaching or deduplicating generated imports", () => {
    const f = setup();
    const upload = f.media.create(f.campaign.id, { name: "Суини у маяка — эскиз мастера.png", dataUrl: png });
    expect(f.media.attach(f.doc.id, upload.id)).toEqual([upload]);
    expect(f.media.importForDocument(f.doc.id, { name: technical, dataUrl: png })).toEqual(upload);
    expect(f.media.get(upload.id)?.name).toBe(upload.name);
  });

  it("humanizes a technical image on its first attachment and synchronizes only owned history", () => {
    const f = setup();
    const image = f.media.create(f.campaign.id, { name: technical, dataUrl: png });
    const local = f.conversations.getOrCreateForCampaign(f.campaign.id);
    const other = f.campaigns.create({ name: "Чужая" });
    const foreign = f.conversations.getOrCreateForCampaign(other.id);
    const foreignDoc = f.documents.create({ campaignId: other.id, type: "npc", title: "Чужое имя" });
    f.sqlite.prepare("INSERT INTO document_images (document_id, image_id) VALUES (?, ?)").run(foreignDoc.id, image.id);
    const meta = { images: [image], imageAttachments: [{ documentId: f.doc.id, documentTitle: f.doc.title, image }] };
    f.conversations.addMessage(local.id, "assistant", "Сохранённый текст", meta);
    f.conversations.addMessage(foreign.id, "assistant", "Чужой текст", meta);
    const attached = f.media.attach(f.doc.id, image.id)[0];
    expect(attached.name).toBe("Олдос Суини — портрет.png");
    const history = f.conversations.listMessages(local.id)[0];
    expect(history.content).toBe("Сохранённый текст");
    expect(history.meta?.images?.[0].name).toBe(attached.name);
    expect(history.meta?.imageAttachments?.[0].image?.name).toBe(attached.name);
    expect(f.conversations.listMessages(foreign.id)[0].meta?.images?.[0].name).toBe(technical);
    expect(f.media.importForDocument(f.doc.id, { name: "illustration.png", dataUrl: png })).toEqual(attached);
    expect(f.media.get(image.id)?.dataUrl).toBe(png);
  });

  it("repairs old image metadata and history on open without touching malformed entries or entity text", () => {
    const root = mkdtempSync(join(tmpdir(), "master-ai-image-names-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, "legacy.sqlite"); const f = setup(path);
    const image = f.media.create(f.campaign.id, { name: technical, dataUrl: png });
    f.sqlite.prepare("INSERT INTO document_images (document_id, image_id) VALUES (?, ?)").run(f.doc.id, image.id);
    const conv = f.conversations.getOrCreateForCampaign(f.campaign.id);
    const message = f.conversations.addMessage(conv.id, "assistant", "Текст и названия карточек неизменны");
    f.sqlite.prepare("UPDATE messages SET meta = ? WHERE id = ?").run(JSON.stringify({ actorName: "Алдар", images: [null, 7, image], imageAttachments: [null, "bad", { documentId: f.doc.id, documentTitle: f.doc.title, image }] }), message.id);
    const malformed = f.conversations.addMessage(conv.id, "user", "Повреждённая мета");
    f.sqlite.prepare("UPDATE messages SET meta = ? WHERE id = ?").run("{broken", malformed.id);
    f.sqlite.close();
    const reopened = createDb(path); cleanups.push(() => { if (reopened.sqlite.open) reopened.sqlite.close(); });
    const media = new MediaService(reopened.db);
    const canonical = { ...image, name: "Олдос Суини — портрет.png" };
    expect(media.listForDocument(f.doc.id)).toEqual([canonical]);
    expect(media.get(image.id)?.dataUrl).toBe(png);
    expect(new DocumentService(reopened.db).get(f.doc.id)).toMatchObject({ title: f.doc.title, contentJson: f.doc.contentJson, fields: f.doc.fields });
    const row = reopened.sqlite.prepare("SELECT content, meta FROM messages WHERE id = ?").get(message.id) as { content: string; meta: string };
    expect(row.content).toBe("Текст и названия карточек неизменны");
    expect(JSON.parse(row.meta)).toEqual({ actorName: "Алдар", images: [null, 7, canonical], imageAttachments: [null, "bad", { documentId: f.doc.id, documentTitle: f.doc.title, image: canonical }] });
    expect(reopened.sqlite.prepare("SELECT meta FROM messages WHERE id = ?").get(malformed.id)).toEqual({ meta: "{broken" });
    const changes = reopened.sqlite.prepare("SELECT total_changes() AS n").get();
    reopened.sqlite.close();
    const again = createDb(path); cleanups.push(() => { if (again.sqlite.open) again.sqlite.close(); });
    expect(again.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual({ n: 0 });
    expect(changes).toEqual({ n: 2 });
    const transfer = new TransferService(again.db);
    // Broken JSON elsewhere must not be rewritten during metadata repair.
    again.sqlite.prepare("DELETE FROM messages WHERE id = ?").run(malformed.id);
    const exported = transfer.export(f.campaign.id)!;
    expect(exported.images[0].name).toBe(canonical.name);
    expect((exported.messages[0].meta as { images: unknown[] }).images[2]).toEqual(canonical);
  });

  it("repairs technical names in legacy imports and preserves readable names through transfer", () => {
    const f = setup();
    const image = f.media.create(f.campaign.id, { name: technical, dataUrl: png });
    f.sqlite.prepare("INSERT INTO document_images (document_id, image_id) VALUES (?, ?)").run(f.doc.id, image.id);
    const conv = f.conversations.getOrCreateForCampaign(f.campaign.id);
    f.conversations.addMessage(conv.id, "assistant", "Иллюстрация готова", {
      images: [image], imageAttachments: [{ documentId: f.doc.id, documentTitle: f.doc.title, image }],
    });
    const transfer = new TransferService(f.db);
    const exported = transfer.export(f.campaign.id)!;
    const imported = transfer.import(exported);
    const doc = f.documents.listByCampaign(imported.id)[0];
    const renamed = f.media.listForDocument(doc.id)[0];
    expect(renamed.name).toBe("Олдос Суини — портрет.png");
    expect(renamed.id).not.toBe(image.id);
    expect(f.media.get(renamed.id)?.dataUrl).toBe(png);
    const importedConv = f.conversations.getOrCreateForCampaign(imported.id);
    expect(f.conversations.listMessages(importedConv.id)[0]).toMatchObject({ content: "Иллюстрация готова", meta: {
      images: [renamed], imageAttachments: [{ documentId: doc.id, documentTitle: f.doc.title, image: renamed }],
    } });
    const roundTrip = transfer.import(transfer.export(imported.id));
    expect(f.media.listForCampaign(roundTrip.id)[0].name).toBe(renamed.name);
  });
});
