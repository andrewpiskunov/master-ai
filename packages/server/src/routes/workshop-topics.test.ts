import { afterEach, describe, expect, it } from "vitest";
import type { CompleteInput } from "@master-ai/shared";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { ConversationService } from "../services/conversations.js";
import { DocumentService } from "../services/documents.js";
import { ProposalService, textToDoc } from "../services/proposals.js";

const opened: { app: ReturnType<typeof buildApp>; sqlite: ReturnType<typeof createDb>["sqlite"] }[] = [];
afterEach(async () => { for (const f of opened.splice(0)) { await f.app.close(); f.sqlite.close(); } });

function setup(wait?: () => Promise<void>) {
  const { db, sqlite } = createDb(":memory:");
  const campaigns = new CampaignService(db);
  const conversations = new ConversationService(db);
  const documents = new DocumentService(db);
  const proposals = new ProposalService(db);
  const campaign = campaigns.create({ name: "Темы", description: "PERMANENT_BRIEF" });
  const conv = conversations.getOrCreateForCampaign(campaign.id);
  const inputs: CompleteInput[] = [];
  const app = buildApp({ db, llm: { async *complete(input) { inputs.push(input); await wait?.(); yield "Текущий ответ"; } } });
  opened.push({ app, sqlite });
  const topic = () => app.inject({ method: "POST", url: `/api/campaigns/${campaign.id}/brainstorm/new-topic` });
  const ask = (message: string) => app.inject({ method: "POST", url: `/api/campaigns/${campaign.id}/brainstorm`, payload: { message } });
  return { app, sqlite, campaign, conv, inputs, conversations, documents, proposals, topic, ask };
}

describe("workshop topics", () => {
  it("preserves history and materials but excludes old text and chat images from the next request", async () => {
    const f = setup();
    const oldImage = { id: "old-image", name: "OLD_CHAT_IMAGE.png", mimeType: "image/png" as const };
    f.conversations.addMessage(f.conv.id, "user", "OLD_TOPIC_SECRET", { images: [oldImage] });
    f.conversations.addMessage(f.conv.id, "assistant", "OLD_REPLY_SECRET", { imageAttachments: [{ documentId: "removed", documentTitle: "Удалённая карточка", image: oldImage }] });
    const doc = f.documents.create({ campaignId: f.campaign.id, title: "Карточка", type: "note", contentJson: textToDoc("CURRENT_DOCUMENT") });
    const proposal = f.proposals.create({ campaignId: f.campaign.id, conversationId: f.conv.id, draft: { type: "note", title: "Предложение", content: "PENDING_DRAFT" } });
    const before = f.conversations.listMessages(f.conv.id);

    const response = await f.topic();
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ role: "assistant", content: "", meta: { workshopTopicStart: true } });
    expect(f.inputs).toEqual([]);
    const history = f.conversations.listMessages(f.conv.id);
    expect(history.slice(0, 2)).toEqual(before);
    expect(history.at(-1)?.id).toBe(response.json().id);
    expect(f.documents.get(doc.id)).toEqual(doc);
    expect(f.proposals.listByCampaign(f.campaign.id, "pending")).toEqual([proposal]);

    const reply = await f.ask("CURRENT_TOPIC_REQUEST");
    expect(reply.statusCode).toBe(200);
    expect(f.inputs[0].messages).toEqual([{ role: "user", content: "CURRENT_TOPIC_REQUEST" }]);
    expect(f.inputs[0].system).toContain("PERMANENT_BRIEF");
    expect(f.inputs[0].system).toContain("CURRENT_DOCUMENT");
    expect(f.inputs[0].system).toContain("PENDING_DRAFT");
    expect(JSON.stringify(f.inputs[0])).not.toContain("OLD_");
    expect(JSON.stringify(f.inputs[0])).not.toContain("old-image");
    expect((await f.app.inject(`/api/campaigns/${f.campaign.id}/conversation`)).json()).toHaveLength(5);
  });

  it("uses only the newest persisted topic for replies and world summaries", async () => {
    const f = setup();
    f.conversations.addMessage(f.conv.id, "user", "FIRST_TOPIC");
    expect((await f.topic()).statusCode).toBe(201);
    f.conversations.addMessage(f.conv.id, "user", "SECOND_TOPIC");
    expect((await f.topic()).statusCode).toBe(201);
    const emptyWorld = await f.app.inject(`/api/campaigns/${f.campaign.id}/world`);
    expect(emptyWorld.json()).toEqual({ summary: "", question: "" });
    expect(f.inputs).toEqual([]);

    await f.ask("THIRD_TOPIC");
    await f.app.inject(`/api/campaigns/${f.campaign.id}/world`);
    expect(f.inputs).toHaveLength(2);
    expect(JSON.stringify(f.inputs)).not.toContain("FIRST_TOPIC");
    expect(JSON.stringify(f.inputs)).not.toContain("SECOND_TOPIC");
    expect(f.inputs[1].messages[0].content).toContain("THIRD_TOPIC");
    expect(f.conversations.listMessages(f.conv.id)).toHaveLength(6);
  });

  it("keeps the topic boundary after export and import", async () => {
    const f = setup();
    f.conversations.addMessage(f.conv.id, "user", "EXPORTED_OLD_SECRET");
    expect((await f.topic()).statusCode).toBe(201);
    f.conversations.addMessage(f.conv.id, "user", "IMPORTED_CURRENT_TOPIC");
    const data = (await f.app.inject(`/api/campaigns/${f.campaign.id}/export-json`)).json();
    const imported = await f.app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: data });
    expect(imported.statusCode).toBe(201);
    const id = imported.json().id;
    const history = (await f.app.inject(`/api/campaigns/${id}/conversation`)).json();
    expect(history.map((m: { content: string }) => m.content)).toEqual(["EXPORTED_OLD_SECRET", "", "IMPORTED_CURRENT_TOPIC"]);
    expect(history[1].meta.workshopTopicStart).toBe(true);
    await f.app.inject({ method: "POST", url: `/api/campaigns/${id}/brainstorm`, payload: { message: "Продолжи" } });
    expect(f.inputs.at(-1)?.messages.map((m) => m.content)).toEqual(["IMPORTED_CURRENT_TOPIC", "Продолжи"]);
  });

  it("rejects a topic switch while a background answer is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = setup(() => gate);
    try {
      expect((await f.app.inject({ method: "POST", url: `/api/campaigns/${f.campaign.id}/brainstorm/start`, payload: { message: "Вопрос" } })).statusCode).toBe(202);
      expect((await f.topic()).statusCode).toBe(409);
      expect(f.conversations.listMessages(f.conv.id)).toHaveLength(1);
    } finally { release(); }
    await expect.poll(async () => (await f.app.inject(`/api/campaigns/${f.campaign.id}/brainstorm/status`)).json().running).toBe(false);
    expect((await f.topic()).statusCode).toBe(201);
    expect(f.conversations.listMessages(f.conv.id).map((m) => m.content)).toEqual(["Вопрос", "Текущий ответ", ""]);
  });

  it("rejects a topic switch while a synchronous answer is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = setup(() => gate);
    const pending = f.ask("Долгий вопрос");
    void pending.then(() => {});
    try {
      await expect.poll(() => f.inputs.length).toBe(1);
      expect((await f.topic()).statusCode).toBe(409);
    } finally { release(); }
    expect((await pending).statusCode).toBe(200);
    expect((await f.topic()).statusCode).toBe(201);
  });

  it("does not create a conversation for an unknown campaign", async () => {
    const f = setup();
    const response = await f.app.inject({ method: "POST", url: "/api/campaigns/missing/brainstorm/new-topic" });
    expect(response.statusCode).toBe(404);
    expect(f.sqlite.prepare("SELECT count(*) AS count FROM conversations").get()).toEqual({ count: 1 });
  });

  it("does not append a late welcome to a newly started topic", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const f = setup(() => gate);
    const created = await f.app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Новая кампания" } });
    const id = created.json().id;
    try {
      expect((await f.app.inject({ method: "POST", url: `/api/campaigns/${id}/brainstorm/new-topic` })).statusCode).toBe(201);
    } finally { release(); }
    // A world request completes after the released welcome generator's continuation.
    await f.app.inject(`/api/campaigns/${id}/world`);
    const history = (await f.app.inject(`/api/campaigns/${id}/conversation`)).json();
    expect(history).toHaveLength(1);
    expect(history[0].meta.workshopTopicStart).toBe(true);
  });
});
