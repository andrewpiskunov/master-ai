import { describe, it, expect } from "vitest";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { FakeProvider } from "./llm/fake.js";
import type { LLMProvider } from "./llm/provider.js";

function makeApp() {
  const { db } = createDb(":memory:");
  // Фейковый LLM: приветствие кампании теперь генерируется ИИ — не дёргаем настоящий CLI в тестах.
  return buildApp({ db, llm: new FakeProvider(["Приветствую! Готов помочь с кампанией."]) });
}

describe("REST API", () => {
  it("POST затем GET кампаний", async () => {
    const app = makeApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: { name: "Город Солнца" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().name).toBe("Город Солнца");

    const list = await app.inject({ method: "GET", url: "/api/campaigns" });
    expect(list.json()).toHaveLength(1);
  });

  it("GET несуществующей кампании → 404", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/campaigns/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("создание и обновление документа", async () => {
    const app = makeApp();
    const c = (
      await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })
    ).json();

    const doc = (
      await app.inject({
        method: "POST",
        url: "/api/documents",
        payload: { campaignId: c.id, type: "npc", title: "Барон" },
      })
    ).json();
    expect(doc.title).toBe("Барон");

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/documents/${doc.id}`,
      payload: { title: "Барон фон Кройц" },
    });
    expect(patched.json().title).toBe("Барон фон Кройц");

    const list = await app.inject({
      method: "GET",
      url: `/api/campaigns/${c.id}/documents`,
    });
    expect(list.json()).toHaveLength(1);
  });

  it("POST кампании с пустым телом → 400", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/api/campaigns", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/document-types отдаёт реестр", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/document-types" });
    expect(res.json().map((t: { key: string }) => t.key)).toContain("npc");
  });

  describe("валидация типа и статуса документа", () => {
    it("POST /api/documents с неизвестным type → 400", async () => {
      const app = makeApp();
      const c = (
        await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })
      ).json();
      const res = await app.inject({
        method: "POST",
        url: "/api/documents",
        payload: { campaignId: c.id, type: "unknown_type", title: "X" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("POST /api/documents с недопустимым status → 400", async () => {
      const app = makeApp();
      const c = (
        await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })
      ).json();
      const res = await app.inject({
        method: "POST",
        url: "/api/documents",
        payload: { campaignId: c.id, type: "npc", title: "X", status: "flying" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("POST /api/documents с несуществующим campaignId → 404", async () => {
      const app = makeApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/documents",
        payload: { campaignId: "no-such-campaign", type: "npc", title: "X" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("PATCH /api/documents/:id с недопустимым status → 400", async () => {
      const app = makeApp();
      const c = (
        await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })
      ).json();
      const doc = (
        await app.inject({
          method: "POST",
          url: "/api/documents",
          payload: { campaignId: c.id, type: "npc", title: "X" },
        })
      ).json();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/documents/${doc.id}`,
        payload: { status: "flying" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("POST /api/documents: допустимый type и status проходят", async () => {
      const app = makeApp();
      const c = (
        await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })
      ).json();
      const res = await app.inject({
        method: "POST",
        url: "/api/documents",
        payload: { campaignId: c.id, type: "npc", title: "X", status: "active" },
      });
      expect(res.statusCode).toBe(201);
    });
  });
});

describe("brainstorm & proposals API", () => {
  function appWithLlm(reply: string) {
    const { db } = createDb(":memory:");
    return buildApp({ db, llm: new FakeProvider([reply]) });
  }
  const llmText = 'Идея!\n\n```json\n{"proposals":[{"type":"npc","title":"Барон","content":"Мрачный."}]}\n```';

  it("brainstorm создаёт предложение, апрув создаёт документ", async () => {
    const app = appWithLlm(llmText);
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })).json();

    const br = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm`, payload: { message: "злодей" } });
    expect(br.statusCode).toBe(200);
    expect(br.json().proposals).toHaveLength(1);
    const proposalId = br.json().proposals[0].id;

    const pending = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/proposals?status=pending` });
    expect(pending.json()).toHaveLength(1);

    const appr = await app.inject({ method: "POST", url: `/api/proposals/${proposalId}/approve` });
    expect(appr.statusCode).toBe(200);
    expect(appr.json().title).toBe("Барон");

    const docs = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` });
    expect(docs.json()).toHaveLength(1);
  });

  it("brainstorm с пустым сообщением → 400", async () => {
    const app = appWithLlm("x");
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })).json();
    const res = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm`, payload: { message: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("reject помечает предложение и не создаёт документ", async () => {
    const app = appWithLlm(llmText);
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })).json();
    const br = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm`, payload: { message: "злодей" } });
    const pid = br.json().proposals[0].id;
    const rej = await app.inject({ method: "POST", url: `/api/proposals/${pid}/reject` });
    expect(rej.statusCode).toBe(200);
    const docs = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` });
    expect(docs.json()).toHaveLength(0);
  });
});

describe("поиск и связи", () => {
  it("search находит документ по контенту", async () => {
    const app = makeApp();
    const c = await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } });
    const campaignId = c.json().id;
    await app.inject({
      method: "POST",
      url: "/api/documents",
      payload: {
        campaignId,
        type: "npc",
        title: "Барон",
        contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "аристократ из замка" }] }] },
      },
    });
    const res = await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}/search?q=${encodeURIComponent("аристократ")}` });
    expect(res.statusCode).toBe(200);
    const hits = res.json();
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("Барон");
  });

  it("создаёт и перечисляет связи, отдаёт обратные ссылки", async () => {
    const app = makeApp();
    const campaignId = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json().id;
    const mk = async (title: string, type: string) =>
      (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId, type, title } })).json().id;
    const a = await mk("Барон", "npc");
    const b = await mk("Замок", "location");
    const created = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/links`,
      payload: { campaignId, fromDocId: a, toDocId: b, kind: "обитает в" },
    });
    expect(created.statusCode).toBe(201);
    const linksB = await app.inject({ method: "GET", url: `/api/documents/${b}/links` });
    expect(linksB.json().incoming).toHaveLength(1);
    expect(linksB.json().incoming[0].document.title).toBe("Барон");
  });

  it("POST link с пустым kind → 400", async () => {
    const app = makeApp();
    const campaignId = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json().id;
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/links`,
      payload: { campaignId, fromDocId: "a", toDocId: "b", kind: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE несуществующей связи → 404", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/links/нет-такой" });
    expect(res.statusCode).toBe(404);
  });
});

describe("LLM endpoint", () => {
  function makeAppWithLlm(chunks: string[]) {
    const { db } = createDb(":memory:");
    return buildApp({ db, llm: new FakeProvider(chunks) });
  }

  it("стримит склеенный ответ провайдера", async () => {
    const app = makeAppWithLlm(["Привет", ", ", "мир"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/llm/complete",
      payload: { messages: [{ role: "user", content: "привет" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("Привет, мир");
  });

  it("400 на невалидном теле (пустой messages)", async () => {
    const app = makeAppWithLlm(["x"]);
    const res = await app.inject({
      method: "POST",
      url: "/api/llm/complete",
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("500 когда провайдер бросает до первого yield", async () => {
    const { db } = createDb(":memory:");
    const errorProvider: LLMProvider = {
      async *complete() {
        throw new Error("boom");
      },
    };
    const app = buildApp({ db, llm: errorProvider });
    const res = await app.inject({
      method: "POST",
      url: "/api/llm/complete",
      payload: { messages: [{ role: "user", content: "привет" }] },
    });
    expect(res.statusCode).toBe(500);
  });
});

describe("жизненный цикл кампании", () => {
  it("создание заводит беседу с приветствием от ИИ", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Авалон" } })).json();
    const conv = await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/conversation` });
    const msgs = conv.json();
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].content).toContain("Приветствую");
  });

  it("DELETE удаляет кампанию и её документы", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Удаляемая" } })).json();
    await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Тест" } });
    const del = await app.inject({ method: "DELETE", url: `/api/campaigns/${c.id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/campaigns/${c.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` })).json()).toHaveLength(0);
  });

  it("DELETE несуществующей кампании → 404", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/campaigns/нет-такой" });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE удаляет документ и его связи", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const a = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "А" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Б" } })).json();
    await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/links`, payload: { campaignId: c.id, fromDocId: a.id, toDocId: b.id, kind: "знает" } });

    const del = await app.inject({ method: "DELETE", url: `/api/documents/${a.id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/documents/${a.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/documents` })).json()).toHaveLength(1);
    // связь, ссылавшаяся на удалённый документ, тоже исчезла
    const bLinks = (await app.inject({ method: "GET", url: `/api/documents/${b.id}/links` })).json();
    expect(bLinks.incoming).toHaveLength(0);
  });

  it("DELETE несуществующего документа → 404", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/documents/нет-такой" });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH меняет тип и сбрасывает несовместимый статус", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const d = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Глеб", status: "active" } })).json();
    // location не имеет статусов — статус "active" должен сброситься
    const res = await app.inject({ method: "PATCH", url: `/api/documents/${d.id}`, payload: { type: "location" } });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.type).toBe("location");
    expect(updated.status).toBeNull();
  });

  it("PATCH на неизвестный тип → 400", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const d = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Глеб" } })).json();
    const res = await app.inject({ method: "PATCH", url: `/api/documents/${d.id}`, payload: { type: "дракон" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("беседа ассистента по документу", () => {
  it("сохраняет реплики и отдаёт их в порядке добавления", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const d = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Глеб" } })).json();

    expect((await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json()).toHaveLength(0);

    await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "user", content: "добавь фамилию" } });
    await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "assistant", content: "Глеб Двукоготь" } });

    const msgs = (await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json();
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toBe("Глеб Двукоготь");

    // беседа Мастерской не загрязнена репликами по документу
    const workshop = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/conversation` })).json();
    expect(workshop.every((m: { content: string }) => m.content !== "добавь фамилию")).toBe(true);
  });

  it("по несуществующему документу → 404", async () => {
    const app = makeApp();
    expect((await app.inject({ method: "GET", url: "/api/documents/нет/conversation" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/documents/нет/conversation/messages", payload: { role: "user", content: "x" } })).statusCode).toBe(404);
  });
});
