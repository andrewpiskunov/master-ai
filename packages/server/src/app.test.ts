import { describe, it, expect } from "vitest";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";
import { FakeProvider } from "./llm/fake.js";

function makeApp() {
  const { db } = createDb(":memory:");
  return buildApp({ db });
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
        payload: { campaignId: c.id, type: "npc", title: "X", status: "alive" },
      });
      expect(res.statusCode).toBe(201);
    });
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
});
