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
  it("GET /api/backup отдаёт валидный файл SQLite; без sqlite-инстанса — 503", async () => {
    const { db, sqlite } = createDb(":memory:");
    const app = buildApp({ db, sqlite, llm: new FakeProvider([""]) });
    const res = await app.inject({ method: "GET", url: "/api/backup" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/master-ai-.*\.sqlite/);
    expect(res.rawPayload.subarray(0, 15).toString()).toBe("SQLite format 3");

    const bare = makeApp(); // без sqlite
    const denied = await bare.inject({ method: "GET", url: "/api/backup" });
    expect(denied.statusCode).toBe(503);
  });

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
  it("создание заводит беседу с приветствием от ИИ (генерируется в фоне)", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "Авалон" } })).json();
    // Приветствие пишется в беседу асинхронно после ответа — дожидаемся его появления.
    let msgs: { role: string; content: string }[] = [];
    for (let i = 0; i < 20 && msgs.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
      msgs = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/conversation` })).json();
    }
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

  it("DELETE очищает беседу; повторное обращение начинает её заново", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const d = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Глеб" } })).json();
    await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "user", content: "привет" } });

    const del = await app.inject({ method: "DELETE", url: `/api/documents/${d.id}/conversation` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json()).toHaveLength(0);
    // и снова можно писать
    const again = await app.inject({ method: "POST", url: `/api/documents/${d.id}/conversation/messages`, payload: { role: "user", content: "заново" } });
    expect(again.statusCode).toBe(201);
  });

  it("по несуществующему документу → 404", async () => {
    const app = makeApp();
    expect((await app.inject({ method: "GET", url: "/api/documents/нет/conversation" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/documents/нет/conversation/messages", payload: { role: "user", content: "x" } })).statusCode).toBe(404);
  });
});

describe("серверная генерация мастерской", () => {
  it("start сохраняет вопрос, задача пишет ответ и создаёт предложения", async () => {
    const { db } = createDb(":memory:");
    const reply = 'Вот идея!\n```json\n{"proposals":[{"type":"npc","title":"Барон","content":"Злодей."}]}\n```';
    const app = buildApp({ db, llm: new FakeProvider([reply]) });
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();

    const started = await app.inject({ method: "POST", url: `/api/campaigns/${c.id}/brainstorm/start`, payload: { message: "Придумай злодея" } });
    expect(started.statusCode).toBe(202);
    for (let i = 0; i < 50; i++) {
      const st = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/brainstorm/status` })).json();
      if (!st.running) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const msgs = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/conversation` })).json();
    // приветствие + вопрос + ответ (без JSON-блока предложений)
    const tail = msgs.slice(-2);
    expect(tail.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(tail[1].content).toBe("Вот идея!");
    const props = (await app.inject({ method: "GET", url: `/api/campaigns/${c.id}/proposals?status=pending` })).json();
    expect(props).toHaveLength(1);
    expect(props[0].title).toBe("Барон");
  });

  it("несуществующая кампания → 404", async () => {
    const app = makeApp();
    expect((await app.inject({ method: "POST", url: "/api/campaigns/нет/brainstorm/start", payload: { message: "x" } })).statusCode).toBe(404);
  });
});

describe("серверная генерация помощника документа", () => {
  it("start сохраняет вопрос, задача копит ответ и записывает его в беседу", async () => {
    const { db } = createDb(":memory:");
    const app = buildApp({ db, llm: new FakeProvider(["", "Ответ помощника."]) }); // 1-й ответ — приветствие кампании
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const d = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "Глеб" } })).json();

    const started = await app.inject({ method: "POST", url: `/api/documents/${d.id}/assistant`, payload: { message: "Кто такой Глеб?", system: "Ты — помощник." } });
    expect(started.statusCode).toBe(202);

    // дожидаемся завершения фоновой задачи
    for (let i = 0; i < 50; i++) {
      const st = (await app.inject({ method: "GET", url: `/api/documents/${d.id}/assistant` })).json();
      if (!st.running) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const msgs = (await app.inject({ method: "GET", url: `/api/documents/${d.id}/conversation` })).json();
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toBe("Ответ помощника.");
  });

  it("stop без задачи → 404, старт по несуществующему документу → 404", async () => {
    const app = makeApp();
    expect((await app.inject({ method: "POST", url: "/api/documents/нет/assistant", payload: { message: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/documents/нет/assistant/stop" })).statusCode).toBe(404);
  });
});

describe("сессии: следующая сессия", () => {
  it("создаёт следующую сессию, помечает текущую сыгранной, идемпотентна", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const sess = (await app.inject({
      method: "POST", url: "/api/documents",
      payload: { campaignId: c.id, type: "session", title: "Сессия 1", fields: { sessionNumber: 1, sessionLog: "Был бой." } },
    })).json();

    const res = await app.inject({ method: "POST", url: `/api/documents/${sess.id}/next-session` });
    expect(res.statusCode).toBe(201);
    const next = res.json();
    expect(next.title).toBe("Сессия 2");
    expect(next.type).toBe("session");
    expect(next.fields.sessionNumber).toBe(2);
    expect(next.fields.prevSessionId).toBe(sess.id);

    // текущая помечена сыгранной и связана со следующей
    const cur = (await app.inject({ method: "GET", url: `/api/documents/${sess.id}` })).json();
    expect(cur.status).toBe("played");
    expect(cur.fields.nextSessionId).toBe(next.id);

    // повторный вызов возвращает ту же следующую сессию
    const again = await app.inject({ method: "POST", url: `/api/documents/${sess.id}/next-session` });
    expect(again.json().id).toBe(next.id);
  });

  it("без fields.sessionNumber номер берётся из названий сессий кампании — дубль «Сессия 1» не создаётся", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    // сессия, созданная ИИ/сидом: номер только в названии, fields.sessionNumber нет
    const sess = (await app.inject({
      method: "POST", url: "/api/documents",
      payload: { campaignId: c.id, type: "session", title: "Сессия 1: Корона", fields: { sessionLog: "лог" } },
    })).json();

    const next = (await app.inject({ method: "POST", url: `/api/documents/${sess.id}/next-session` })).json();
    expect(next.title).toBe("Сессия 2");
    expect(next.fields.sessionNumber).toBe(2);
  });

  it("для не-сессии → 400, для отсутствующего документа → 404", async () => {
    const app = makeApp();
    const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json();
    const npc = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "npc", title: "N" } })).json();
    expect((await app.inject({ method: "POST", url: `/api/documents/${npc.id}/next-session` })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/documents/нет/next-session" })).statusCode).toBe(404);
  });
});
