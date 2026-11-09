import { afterEach, describe, expect, it } from "vitest";
import type { CompleteInput } from "@master-ai/shared";
import { buildApp } from "../app.js";
import { createDb } from "../db/client.js";
import { CampaignService } from "../services/campaigns.js";
import { DocumentService } from "../services/documents.js";
import { textToDoc } from "../services/proposals.js";

const opened: { app: ReturnType<typeof buildApp>; sqlite: ReturnType<typeof createDb>["sqlite"] }[] = [];
afterEach(async () => { for (const f of opened.splice(0)) { await f.app.close(); f.sqlite.close(); } });

function setup() {
  const { db, sqlite } = createDb(":memory:");
  const campaigns = new CampaignService(db);
  const documents = new DocumentService(db);
  const campaign = campaigns.create({ name: "Маяк", description: "BRIEF: северная готика, магия требует цены." });
  const session = documents.create({ campaignId: campaign.id, type: "session", title: "Сессия 1", contentJson: textToDoc("SERVER_CURRENT_SESSION_PLAN") });
  const seen: CompleteInput[] = [];
  const app = buildApp({ db, llm: { async *complete(input) { seen.push(input); yield "Ответ"; } } });
  opened.push({ app, sqlite });
  const create = (title: string, content: string, type = "npc", campaignId = campaign.id) =>
    documents.create({ campaignId, type, title, contentJson: textToDoc(content) });
  return { app, campaign, session, documents, seen, create };
}

async function start(f: ReturnType<typeof setup>, message: string, system?: string) {
  const response = await f.app.inject({ method: "POST", url: `/api/documents/${f.session.id}/assistant`, payload: { mode: "game", message, system } });
  expect(response.statusCode).toBe(202);
  await expect.poll(() => f.seen.length).toBe(1);
  return f.seen[0];
}

function context(input: CompleteInput) {
  expect(input.system).toContain("Контекст кампании (JSON):\n");
  return JSON.parse(input.system!.split("Контекст кампании (JSON):\n")[1].split("\n")[0]) as {
    documents: Array<{ id: string; title: string; type: string; status: string | null; updatedAt: string; content: string; contentTruncated: boolean; images?: unknown[] }>;
  };
}

describe("game assistant campaign context", () => {
  it("uses latest full campaign documents, fields and statuses with IDs and brief despite a stale client plan", async () => {
    const f = setup();
    for (const type of ["npc", "pc", "location", "scene", "secret", "item", "reference"]) {
      f.create(`Карточка ${type}`, `Содержимое ${type}: Сила 3, Ловкость 2.`, type);
    }
    const npc = f.documents.listByCampaign(f.campaign.id).find((d) => d.type === "npc")!;
    const current = f.documents.update(npc.id, { status: "active", fields: { mechanics: { strength: 271828 } }, contentJson: textToDoc("CURRENT_NPC_TEXT_END") })!;
    const removed = f.create("Убрана", "DELETED_MATERIAL");
    f.documents.delete(removed.id);
    f.create("Чужая", "FOREIGN_CAMPAIGN_SECRET", "npc", "another-campaign");

    const input = await start(f, "Измени карточки после разговора", "CLIENT_OLD_SESSION_PLAN");
    const sources = context(input).documents;
    expect(sources).toHaveLength(8);
    expect(sources.find((d) => d.id === current.id)).toMatchObject({ title: current.title, type: "npc", status: "active", updatedAt: current.updatedAt, contentTruncated: false });
    expect(sources.find((d) => d.id === current.id)!.content).toContain("CURRENT_NPC_TEXT_END");
    expect(sources.find((d) => d.id === current.id)!.content).toContain('"mechanics":{"strength":271828}');
    expect(sources.find((d) => d.id === f.session.id)!.content).toBe("SERVER_CURRENT_SESSION_PLAN");
    for (const type of ["pc", "location", "scene", "secret", "item", "reference"]) {
      expect(sources.find((d) => d.type === type)!.content).toBe(`Содержимое ${type}: Сила 3, Ловкость 2.`);
    }
    expect(sources.every((d) => !("images" in d))).toBe(true);
    expect(input.system).toContain("BRIEF: северная готика, магия требует цены.");
    expect(input.system).toContain("CLIENT_OLD_SESSION_PLAN");
    expect(input.system).not.toContain("FOREIGN_CAMPAIGN_SECRET");
    expect(input.system).not.toContain("DELETED_MATERIAL");
    expect(input.system).toContain("```edit-doc");
    expect(input.system).toContain("id:");
    expect(input.system).toContain("title:");
    expect(input.system).toContain("rename:");
    expect(input.system).toContain("\n---\n");
    expect(input.system).not.toContain("action: update");
    expect(input.messages.at(-1)?.content).toBe("Измени карточки после разговора");
  });

  it("marks oversized sources, keeps small cards and prioritizes a named full card within the shared budget", async () => {
    const f = setup();
    f.create("Большой архив", "A".repeat(200000));
    f.create("Ключевая сцена", "B".repeat(100000) + "TARGET_FINAL_CLUE", "scene");
    f.create("Короткая улика", "SMALL_BUT_ESSENTIAL_CLUE");
    const input = await start(f, "Обнови Ключевая сцена");
    const sources = context(input).documents;
    expect(sources).toHaveLength(4);
    expect(sources.find((d) => d.title === "Ключевая сцена")).toMatchObject({ content: "B".repeat(100000) + "TARGET_FINAL_CLUE", contentTruncated: false });
    expect(sources.find((d) => d.title === "Короткая улика")).toMatchObject({ content: "SMALL_BUT_ESSENTIAL_CLUE", contentTruncated: false });
    expect(sources.find((d) => d.title === "Большой архив")!.contentTruncated).toBe(true);
    expect(sources.reduce((sum, d) => sum + d.content.length, 0)).toBeLessThanOrEqual(180000);
    expect(input.system).toContain("Не выдавай её за полный текст");
  });
});
