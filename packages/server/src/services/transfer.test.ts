import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { buildApp } from "../app.js";
import { FakeProvider } from "../llm/fake.js";

function makeApp() {
  const { db } = createDb(":memory:");
  return buildApp({ db, llm: new FakeProvider(["Ответ ИИ."]) });
}

describe("Экспорт/импорт кампании (JSON)", () => {
  it("полный цикл: экспорт всего содержимого и импорт как новой кампании с перевязкой id", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Корона", system: "D&D 5e", description: "мрачно" } })).json();

    // Наполняем: документы со связью сессий, беседа мастерской с сообщением, связь, расход.
    const npc = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Барон Кройц" } })).json();
    const sess = (await app.inject({
      method: "POST", url: "/api/documents",
      payload: { campaignId: c.id, type: "session", title: "Сессия 1", fields: { sessionNumber: 1, sessionLog: "лог" } },
    })).json();
    const next = (await app.inject({ method: "POST", url: `/api/documents/${sess.id}/next-session` })).json();
    await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/links`, payload: { campaignId: c.id, fromDocId: sess.id, toDocId: npc.id, kind: "упоминает" } });
    await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm`, payload: { message: "придумай злодея" } });

    const res = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/export-json` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("master-ai.json");
    const data = res.json();
    expect(data.format).toBe("master-ai-campaign");
    expect(data.version).toBe(1);
    expect(data.documents.length).toBeGreaterThanOrEqual(3);
    expect(data.messages.length).toBeGreaterThanOrEqual(2); // приветствие + вопрос/ответ мастерской
    expect(data.llmUsage.length).toBeGreaterThanOrEqual(1);
    // Ключ API не должен утекать в файл.
    expect(JSON.stringify(data)).not.toContain("apiKey");

    // Импорт: новая кампания, всё содержимое на месте, id перевязаны.
    const imported = (await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: data })).json();
    expect(imported.id).not.toBe(c.id);
    expect(imported.name).toBe("Корона");

    const docs = (await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/documents` })).json();
    expect(docs).toHaveLength(data.documents.length);
    const iSess = docs.find((d: { title: string }) => d.title === "Сессия 1");
    const iNext = docs.find((d: { title: string }) => d.title === next.title);
    // Ссылки prev/next перевязаны на НОВЫЕ id, а не на старые из файла.
    expect(iSess.fields.nextSessionId).toBe(iNext.id);
    expect(iNext.fields.prevSessionId).toBe(iSess.id);

    const conv = (await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/conversation` })).json();
    expect(conv.length).toBe(data.messages.length);

    const usage = (await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/llm-usage` })).json();
    expect(usage.total.requests).toBe(data.llmUsage.length);

    // Поиск работает по импортированным документам (FTS переиндексирован).
    const found = (await app.inject({ method: "GET", url: `/api/campaigns/${imported.id}/search?q=Кройц` })).json();
    expect(found.some((h: { title: string }) => h.title === "Барон Кройц")).toBe(true);
  });

  it("битый файл → 400 с понятной ошибкой, экспорт несуществующей кампании → 404", async () => {
    const app = makeApp();
    const bad = await app.inject({ method: "POST", url: "/api/campaigns/import-json", payload: { format: "что-то" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain("master-ai-campaign");
    expect((await app.inject({ method: "GET", url: "/api/campaigns/нет/export-json" })).statusCode).toBe(404);
  });

  it("lets image-rich campaign payloads above 100 MiB reach parsing", async () => {
    const app = makeApp();
    try {
      // Exercise the parser's advertised-length gate without a 100+ MiB allocation.
      // Eight 10 MiB images already need more than 100 MiB after base64 encoding.
      const res = await app.inject({
        method: "POST", url: "/api/campaigns/import-json", payload: "{}",
        headers: { "content-type": "application/json", "content-length": String(128 * 1024 * 1024) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("FST_ERR_CTP_INVALID_CONTENT_LENGTH");
    } finally { await app.close(); }
  });

  it("rejects imports above 512 MiB with a readable size error", async () => {
    const app = makeApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/api/campaigns/import-json", payload: "{}",
        headers: { "content-type": "application/json", "content-length": String(512 * 1024 * 1024 + 1) },
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toContain("512 МиБ");
    } finally { await app.close(); }
  });
});
