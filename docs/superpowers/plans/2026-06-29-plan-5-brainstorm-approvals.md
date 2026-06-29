# master-ai — План 5: Брейнсторм и апрувы

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Мастер обсуждает идеи с AI в чате кампании; AI отвечает текстом и предлагает структурированные черновики документов, которые попадают в очередь апрувов; принятый черновик становится документом базы.

**Architecture:** Брейнсторм — НЕ стриминг: бэкенд собирает полный ответ провайдера (`provider.complete`), парсит из него опциональный JSON-блок с предложениями (`parseProposals`), сохраняет реплику и `Proposal`-строки, возвращает `{reply, proposals}`. Апрув создаёт `Document` (через `DocumentService`) из черновика (текст → простой ProseMirror-документ). Чат и очередь живут на странице кампании (Workshop).

**Tech Stack:** Fastify, Drizzle (новая миграция), zod, React, Vitest.

## Global Constraints

- Node 20+, pnpm. TypeScript ESM ("module":"NodeNext") — относительные импорты с `.js`; типы из `@master-ai/shared`.
- Тесты — Vitest (+ jsdom для компонентов). `pnpm -r typecheck` должен проходить. Компонентные тесты страниц оборачивать в `<ToastProvider>` (страницы используют `useToast`).
- Каждый таск завершается зелёными тестами + коммит. Коммиты — только имя автора, без Co-Authored-By/AI-трейлеров.
- Реестр типов документов — `DOCUMENT_TYPES`/`getDocumentType` (`@master-ai/shared`). Неизвестный `type` в черновике игнорируется при парсинге.
- LLM-провайдер инъектируется в `buildApp({ db, llm })` (План 3); в тестах — `FakeProvider`.
- Рабочая директория: `Docs/НРИ/master-ai/`.

---

### Task 1: Типы Proposal / Conversation в shared

**Files:**
- Create: `packages/shared/src/proposal.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/proposal.test.ts`

**Interfaces:**
- Produces:
  - `ProposalStatusSchema` = enum `"pending"|"approved"|"rejected"`.
  - `ProposalSchema` / `Proposal = { id, campaignId, conversationId, type, title, content, fields: Record<string,unknown>, status, createdAt }`.
  - `DraftProposalSchema` / `DraftProposal = { type: string; title: string; content: string; fields?: Record<string,unknown> }` — форма, в которой LLM присылает предложение.
  - `ConversationMessage = { id: string; role: "user"|"assistant"; content: string; createdAt: string }`.
  - `BrainstormResponse = { conversationId: string; reply: string; proposals: Proposal[] }`.

- [ ] **Step 1: Падающий тест**

`packages/shared/src/proposal.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ProposalSchema, DraftProposalSchema } from "./proposal.js";

describe("proposal schemas", () => {
  it("ProposalSchema принимает валидное предложение", () => {
    const v = {
      id: "p1", campaignId: "c1", conversationId: "k1",
      type: "npc", title: "Барон", content: "Мрачный аристократ.",
      fields: {}, status: "pending", createdAt: "2026-06-29T00:00:00.000Z",
    };
    expect(ProposalSchema.parse(v)).toEqual(v);
  });

  it("DraftProposalSchema требует type/title/content", () => {
    const d = DraftProposalSchema.parse({ type: "npc", title: "X", content: "Y" });
    expect(d.title).toBe("X");
  });

  it("ProposalSchema отвергает неизвестный статус", () => {
    expect(() =>
      ProposalSchema.parse({ id: "p", campaignId: "c", conversationId: "k", type: "npc", title: "t", content: "c", fields: {}, status: "maybe", createdAt: "x" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/shared test proposal`
Expected: FAIL — `./proposal.js` не найден.

- [ ] **Step 3: Реализовать**

`packages/shared/src/proposal.ts`:
```ts
import { z } from "zod";

export const ProposalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  conversationId: z.string(),
  type: z.string(),
  title: z.string(),
  content: z.string(),
  fields: z.record(z.unknown()),
  status: ProposalStatusSchema,
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const DraftProposalSchema = z.object({
  type: z.string(),
  title: z.string(),
  content: z.string(),
  fields: z.record(z.unknown()).optional(),
});
export type DraftProposal = z.infer<typeof DraftProposalSchema>;

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface BrainstormResponse {
  conversationId: string;
  reply: string;
  proposals: Proposal[];
}
```

`packages/shared/src/index.ts` — добавить:
```ts
export * from "./proposal.js";
```

- [ ] **Step 4: Тест зелёный + typecheck**

Run: `pnpm --filter @master-ai/shared test && pnpm --filter @master-ai/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "master-ai: типы Proposal/Conversation в shared"
```

---

### Task 2: Таблицы conversations / messages / proposals (миграция)

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Create (генерируется): `packages/server/drizzle/0001_*.sql` (+ обновлённый snapshot/journal)
- Test: `packages/server/src/db/conversations-schema.test.ts`

**Interfaces:**
- Produces Drizzle-таблицы: `conversations` (`id`, `campaign_id`, `created_at`), `messages` (`id`, `conversation_id`, `role`, `content`, `created_at`), `proposals` (`id`, `campaign_id`, `conversation_id`, `type`, `title`, `content`, `fields` TEXT JSON default `'{}'`, `status` default `'pending'`, `created_at`).
- Миграция применяется в `createDb` (уже использует `migrate(...)` из Плана 1 fixes).

- [ ] **Step 1: Добавить таблицы в schema.ts**

В `packages/server/src/db/schema.ts` добавить (рядом с `campaigns`/`documents`):
```ts
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  fields: text("fields").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});
```

- [ ] **Step 2: Сгенерировать миграцию**

Run: `pnpm --filter @master-ai/server exec drizzle-kit generate`
Expected: появляется `packages/server/drizzle/0001_*.sql` с тремя `CREATE TABLE` и обновляется `drizzle/meta`.

- [ ] **Step 3: Падающий тест на таблицы**

`packages/server/src/db/conversations-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "./client.js";
import { conversations, proposals } from "./schema.js";

describe("новые таблицы", () => {
  it("conversations и proposals создаются миграцией", () => {
    const { db } = createDb(":memory:");
    db.insert(conversations).values({ id: "k1", campaignId: "c1", createdAt: "x" }).run();
    expect(db.select().from(conversations).all()).toHaveLength(1);
    db.insert(proposals).values({
      id: "p1", campaignId: "c1", conversationId: "k1", type: "npc",
      title: "t", content: "c", fields: "{}", status: "pending", createdAt: "x",
    }).run();
    expect(db.select().from(proposals).all()).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Запустить — должно пройти после генерации миграции**

Run: `pnpm --filter @master-ai/server test conversations-schema`
Expected: PASS (миграция 0001 применяется в `createDb`). Если FAIL «no such table» — миграция не сгенерирована/не применяется; перегенерируй и проверь, что `migrate` читает папку `drizzle`.

- [ ] **Step 5: typecheck + commit**

Run: `pnpm --filter @master-ai/server typecheck`
```bash
git add packages/server/src/db packages/server/drizzle
git commit -m "master-ai: таблицы conversations/messages/proposals (миграция 0001)"
```

---

### Task 3: ConversationService и ProposalService

**Files:**
- Create: `packages/server/src/services/conversations.ts`
- Create: `packages/server/src/services/proposals.ts`
- Test: `packages/server/src/services/conversations.test.ts`
- Test: `packages/server/src/services/proposals.test.ts`

**Interfaces:**
- Consumes: `createDb`, таблицы (Task 2), `DocumentService` (План 1), `Proposal`/`ConversationMessage`/`DraftProposal` (Task 1).
- Produces:
  - `ConversationService(db)`:
    - `getOrCreateForCampaign(campaignId: string): { id: string }` — одна беседа на кампанию (создаёт при отсутствии).
    - `addMessage(conversationId, role: "user"|"assistant", content): ConversationMessage`.
    - `listMessages(conversationId): ConversationMessage[]` (по возрастанию createdAt).
  - `ProposalService(db)`:
    - `create(input: { campaignId; conversationId; draft: DraftProposal }): Proposal` (status `"pending"`).
    - `listByCampaign(campaignId, status?): Proposal[]`.
    - `get(id): Proposal | undefined`.
    - `approve(id, documents: DocumentService): Document | undefined` — помечает `approved`, создаёт документ из черновика (контент = `textToDoc(content)`), возвращает документ; `undefined` если нет/не pending.
    - `reject(id): Proposal | undefined` — помечает `rejected`.
  - `textToDoc(text: string): unknown` (экспорт из `proposals.ts`) — превращает текст в ProseMirror-документ: непустые строки → параграфы.

- [ ] **Step 1: Падающий тест conversations**

`packages/server/src/services/conversations.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { ConversationService } from "./conversations.js";

function svc() { return new ConversationService(createDb(":memory:").db); }

describe("ConversationService", () => {
  it("getOrCreateForCampaign возвращает ту же беседу", () => {
    const s = svc();
    const a = s.getOrCreateForCampaign("c1");
    const b = s.getOrCreateForCampaign("c1");
    expect(a.id).toBe(b.id);
  });

  it("addMessage/listMessages сохраняют порядок", () => {
    const s = svc();
    const { id } = s.getOrCreateForCampaign("c1");
    s.addMessage(id, "user", "привет");
    s.addMessage(id, "assistant", "и тебе");
    const msgs = s.listMessages(id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
```

- [ ] **Step 2: Падающий тест proposals**

`packages/server/src/services/proposals.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { ProposalService, textToDoc } from "./proposals.js";
import { DocumentService } from "./documents.js";

function setup() {
  const { db } = createDb(":memory:");
  return { proposals: new ProposalService(db), documents: new DocumentService(db) };
}

describe("ProposalService", () => {
  it("create сохраняет pending-предложение", () => {
    const { proposals } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "Барон", content: "текст" } });
    expect(p.status).toBe("pending");
    expect(proposals.listByCampaign("c1", "pending")).toHaveLength(1);
  });

  it("approve создаёт документ и помечает approved", () => {
    const { proposals, documents } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "Барон", content: "Мрачный аристократ." } });
    const doc = proposals.approve(p.id, documents);
    expect(doc?.title).toBe("Барон");
    expect(doc?.type).toBe("npc");
    expect(proposals.get(p.id)?.status).toBe("approved");
    expect(documents.listByCampaign("c1")).toHaveLength(1);
  });

  it("reject помечает rejected и не создаёт документ", () => {
    const { proposals, documents } = setup();
    const p = proposals.create({ campaignId: "c1", conversationId: "k1", draft: { type: "npc", title: "X", content: "Y" } });
    proposals.reject(p.id);
    expect(proposals.get(p.id)?.status).toBe("rejected");
    expect(documents.listByCampaign("c1")).toHaveLength(0);
  });

  it("textToDoc делает параграфы из строк", () => {
    const doc = textToDoc("первая\nвторая") as { content: unknown[] };
    expect(doc.content).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test "conversations|proposals"`
Expected: FAIL — модулей нет.

- [ ] **Step 4: Реализовать conversations.ts**

`packages/server/src/services/conversations.ts`:
```ts
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ConversationMessage } from "@master-ai/shared";
import { conversations, messages } from "../db/schema.js";

export class ConversationService {
  constructor(private db: BetterSQLite3Database) {}

  getOrCreateForCampaign(campaignId: string): { id: string } {
    const existing = this.db.select().from(conversations).where(eq(conversations.campaignId, campaignId)).get();
    if (existing) return { id: existing.id };
    const row = { id: randomUUID(), campaignId, createdAt: new Date().toISOString() };
    this.db.insert(conversations).values(row).run();
    return { id: row.id };
  }

  addMessage(conversationId: string, role: "user" | "assistant", content: string): ConversationMessage {
    const row = { id: randomUUID(), conversationId, role, content, createdAt: new Date().toISOString() };
    this.db.insert(messages).values(row).run();
    return { id: row.id, role, content, createdAt: row.createdAt };
  }

  listMessages(conversationId: string): ConversationMessage[] {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all();
    return rows.map((r) => ({ id: r.id, role: r.role as "user" | "assistant", content: r.content, createdAt: r.createdAt }));
  }
}
```

- [ ] **Step 5: Реализовать proposals.ts**

`packages/server/src/services/proposals.ts`:
```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, DraftProposal, Proposal, ProposalStatus } from "@master-ai/shared";
import { proposals } from "../db/schema.js";
import type { DocumentService } from "./documents.js";

export function textToDoc(text: string): unknown {
  const paragraphs = text.split("\n").filter((line) => line.trim().length > 0);
  return {
    type: "doc",
    content: paragraphs.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

interface ProposalRow {
  id: string; campaignId: string; conversationId: string; type: string;
  title: string; content: string; fields: string; status: string; createdAt: string;
}

function toProposal(r: ProposalRow): Proposal {
  return { ...r, fields: JSON.parse(r.fields), status: r.status as ProposalStatus };
}

export class ProposalService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: { campaignId: string; conversationId: string; draft: DraftProposal }): Proposal {
    const row: ProposalRow = {
      id: randomUUID(),
      campaignId: input.campaignId,
      conversationId: input.conversationId,
      type: input.draft.type,
      title: input.draft.title,
      content: input.draft.content,
      fields: JSON.stringify(input.draft.fields ?? {}),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.db.insert(proposals).values(row).run();
    return toProposal(row);
  }

  listByCampaign(campaignId: string, status?: ProposalStatus): Proposal[] {
    const where = status
      ? and(eq(proposals.campaignId, campaignId), eq(proposals.status, status))
      : eq(proposals.campaignId, campaignId);
    return (this.db.select().from(proposals).where(where).all() as ProposalRow[]).map(toProposal);
  }

  get(id: string): Proposal | undefined {
    const r = this.db.select().from(proposals).where(eq(proposals.id, id)).get() as ProposalRow | undefined;
    return r ? toProposal(r) : undefined;
  }

  approve(id: string, documents: DocumentService): Document | undefined {
    const p = this.get(id);
    if (!p || p.status !== "pending") return undefined;
    const doc = documents.create({
      campaignId: p.campaignId,
      type: p.type,
      title: p.title,
      contentJson: textToDoc(p.content),
      fields: p.fields,
    });
    this.db.update(proposals).set({ status: "approved" }).where(eq(proposals.id, id)).run();
    return doc;
  }

  reject(id: string): Proposal | undefined {
    const p = this.get(id);
    if (!p) return undefined;
    this.db.update(proposals).set({ status: "rejected" }).where(eq(proposals.id, id)).run();
    return this.get(id);
  }
}
```

- [ ] **Step 6: Тесты зелёные + typecheck**

Run: `pnpm --filter @master-ai/server test "conversations|proposals" && pnpm --filter @master-ai/server typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/conversations.ts packages/server/src/services/conversations.test.ts packages/server/src/services/proposals.ts packages/server/src/services/proposals.test.ts
git commit -m "master-ai: сервисы бесед и предложений (approve→документ)"
```

---

### Task 4: parseProposals и BrainstormService

**Files:**
- Create: `packages/server/src/llm/parse-proposals.ts`
- Create: `packages/server/src/services/brainstorm.ts`
- Test: `packages/server/src/llm/parse-proposals.test.ts`
- Test: `packages/server/src/services/brainstorm.test.ts`

**Interfaces:**
- Consumes: `LLMProvider` (План 3), `ConversationService`/`ProposalService` (Task 3), `DraftProposal`/`BrainstormResponse` (Task 1).
- Produces:
  - `parseProposals(text: string): { reply: string; proposals: DraftProposal[] }` — ищет последний fenced-блок ```json … ``` с `{ "proposals": [...] }`; валидные элементы по `DraftProposalSchema` (и `getDocumentType(type)` существует) попадают в `proposals`; блок вырезается из текста (остаток — `reply`). Если блока нет/JSON битый — `proposals: []`, `reply` = исходный текст.
  - `BrainstormService(deps: { llm; conversations; proposals })`:
    - `respond(campaignId: string, userMessage: string): Promise<BrainstormResponse>` — get-or-create беседа; сохранить user-сообщение; собрать messages (system-промпт про формат предложений + история); собрать полный ответ из `llm.complete`; `parseProposals`; сохранить assistant-реплику (reply); создать `Proposal` на каждый draft; вернуть `{ conversationId, reply, proposals }`.

- [ ] **Step 1: Падающий тест parseProposals**

`packages/server/src/llm/parse-proposals.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseProposals } from "./parse-proposals.js";

describe("parseProposals", () => {
  it("извлекает предложения из json-блока и чистит reply", () => {
    const text = 'Вот идея для NPC.\n\n```json\n{"proposals":[{"type":"npc","title":"Барон","content":"Мрачный."}]}\n```';
    const { reply, proposals } = parseProposals(text);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toBe("Барон");
    expect(reply).toContain("Вот идея для NPC.");
    expect(reply).not.toContain("```");
  });

  it("без блока возвращает текст и пустые proposals", () => {
    const { reply, proposals } = parseProposals("просто ответ");
    expect(proposals).toHaveLength(0);
    expect(reply).toBe("просто ответ");
  });

  it("игнорирует неизвестный тип документа", () => {
    const text = '```json\n{"proposals":[{"type":"чепуха","title":"X","content":"Y"}]}\n```';
    expect(parseProposals(text).proposals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Падающий тест BrainstormService**

`packages/server/src/services/brainstorm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { FakeProvider } from "../llm/fake.js";
import { ConversationService } from "./conversations.js";
import { ProposalService } from "./proposals.js";
import { BrainstormService } from "./brainstorm.js";

function make(reply: string) {
  const { db } = createDb(":memory:");
  return new BrainstormService({
    llm: new FakeProvider([reply]),
    conversations: new ConversationService(db),
    proposals: new ProposalService(db),
  });
}

describe("BrainstormService", () => {
  it("сохраняет реплику и создаёт предложения из ответа", async () => {
    const llmText = 'Идея!\n\n```json\n{"proposals":[{"type":"npc","title":"Барон","content":"Мрачный."}]}\n```';
    const svc = make(llmText);
    const res = await svc.respond("c1", "придумай злодея");
    expect(res.reply).toContain("Идея!");
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0].title).toBe("Барон");
    expect(res.proposals[0].status).toBe("pending");
    expect(res.conversationId).toMatch(/.+/);
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test "parse-proposals|brainstorm"`
Expected: FAIL — модулей нет.

- [ ] **Step 4: Реализовать parse-proposals.ts**

`packages/server/src/llm/parse-proposals.ts`:
```ts
import { DraftProposalSchema, getDocumentType, type DraftProposal } from "@master-ai/shared";

const JSON_BLOCK = /```json\s*([\s\S]*?)```/gi;

export function parseProposals(text: string): { reply: string; proposals: DraftProposal[] } {
  const matches = [...text.matchAll(JSON_BLOCK)];
  if (matches.length === 0) return { reply: text, proposals: [] };

  const proposals: DraftProposal[] = [];
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1]) as { proposals?: unknown[] };
      for (const raw of parsed.proposals ?? []) {
        const draft = DraftProposalSchema.safeParse(raw);
        if (draft.success && getDocumentType(draft.data.type)) {
          proposals.push(draft.data);
        }
      }
    } catch {
      // битый JSON — пропускаем блок
    }
  }
  const reply = text.replace(JSON_BLOCK, "").trim();
  return { reply, proposals };
}
```

- [ ] **Step 5: Реализовать brainstorm.ts**

`packages/server/src/services/brainstorm.ts`:
```ts
import type { BrainstormResponse, LlmMessage, Proposal } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import { parseProposals } from "../llm/parse-proposals.js";
import type { ConversationService } from "./conversations.js";
import type { ProposalService } from "./proposals.js";

const SYSTEM_PROMPT = [
  "Ты — соавтор мастера настольных ролевых игр. Отвечай по-русски.",
  "Когда уместно предложить готовый материал (NPC, локацию, секрет, сцену и т.п.),",
  "добавь В КОНЦЕ ответа блок ```json {\"proposals\":[{\"type\":\"npc\",\"title\":\"...\",\"content\":\"...\"}]}``` .",
  "Поле type — один из ключей: npc, location, faction, secret, scene, session, item, lore, note.",
].join(" ");

export class BrainstormService {
  constructor(
    private deps: { llm: LLMProvider; conversations: ConversationService; proposals: ProposalService },
  ) {}

  async respond(campaignId: string, userMessage: string): Promise<BrainstormResponse> {
    const { conversations, proposals, llm } = this.deps;
    const conv = conversations.getOrCreateForCampaign(campaignId);
    conversations.addMessage(conv.id, "user", userMessage);

    const history: LlmMessage[] = conversations
      .listMessages(conv.id)
      .map((m) => ({ role: m.role, content: m.content }));

    let full = "";
    for await (const chunk of llm.complete({ system: SYSTEM_PROMPT, messages: history })) {
      full += chunk;
    }

    const { reply, proposals: drafts } = parseProposals(full);
    conversations.addMessage(conv.id, "assistant", reply);

    const created: Proposal[] = drafts.map((draft) =>
      proposals.create({ campaignId, conversationId: conv.id, draft }),
    );

    return { conversationId: conv.id, reply, proposals: created };
  }
}
```

- [ ] **Step 6: Тесты зелёные + typecheck**

Run: `pnpm --filter @master-ai/server test "parse-proposals|brainstorm" && pnpm --filter @master-ai/server typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/llm/parse-proposals.ts packages/server/src/llm/parse-proposals.test.ts packages/server/src/services/brainstorm.ts packages/server/src/services/brainstorm.test.ts
git commit -m "master-ai: parseProposals и BrainstormService"
```

---

### Task 5: Эндпоинты брейнсторма и апрувов

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts` (добавить кейсы)

**Interfaces:**
- Consumes: `ConversationService`, `ProposalService`, `BrainstormService` (Tasks 3–4), `DocumentService`/`CampaignService` (уже есть), `llm` из `buildApp`.
- Produces маршруты:
  - `POST /api/campaigns/:id/brainstorm` (body `{ message: string }`) → `BrainstormResponse` (200; 400 на пустое сообщение).
  - `GET /api/campaigns/:id/proposals?status=pending` → `Proposal[]`.
  - `GET /api/campaigns/:id/conversation` → `ConversationMessage[]` (сообщения текущей беседы кампании).
  - `POST /api/proposals/:id/approve` → созданный `Document` (200) | 404/409 если нет/не pending.
  - `POST /api/proposals/:id/reject` → `Proposal` | 404.
- В `buildApp` создаются экземпляры новых сервисов (используя тот же `deps.db` и `llm`).

- [ ] **Step 1: Падающие тесты эндпоинтов**

Добавить в `packages/server/src/app.test.ts` новый describe (сборка приложения с `FakeProvider`, выдающим json-блок):
```ts
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
```
> Убедись, что `FakeProvider` уже импортирован в `app.test.ts` (добавлен в Плане 3).

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test app`
Expected: FAIL — новых маршрутов нет.

- [ ] **Step 3: Реализовать в app.ts**

Импорты (добавить):
```ts
import { ConversationService } from "./services/conversations.js";
import { ProposalService } from "./services/proposals.js";
import { BrainstormService } from "./services/brainstorm.js";
import { z } from "zod"; // уже импортирован — не дублируй
```
В начале `buildApp` (после существующих сервисов):
```ts
  const conversationsSvc = new ConversationService(deps.db);
  const proposalsSvc = new ProposalService(deps.db);
  const brainstormSvc = new BrainstormService({ llm, conversations: conversationsSvc, proposals: proposalsSvc });
  const BrainstormBodySchema = z.object({ message: z.string().min(1) });
```
Маршруты:
```ts
  app.post("/api/campaigns/:id/brainstorm", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = BrainstormBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return brainstormSvc.respond(id, parsed.data.message);
  });

  app.get("/api/campaigns/:id/proposals", (req) => {
    const { id } = req.params as { id: string };
    const { status } = req.query as { status?: "pending" | "approved" | "rejected" };
    return proposalsSvc.listByCampaign(id, status);
  });

  app.get("/api/campaigns/:id/conversation", (req) => {
    const { id } = req.params as { id: string };
    const conv = conversationsSvc.getOrCreateForCampaign(id);
    return conversationsSvc.listMessages(conv.id);
  });

  app.post("/api/proposals/:id/approve", (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = proposalsSvc.approve(id, documentsSvc);
    if (!doc) return reply.code(409).send({ error: "предложение не найдено или уже обработано" });
    return doc;
  });

  app.post("/api/proposals/:id/reject", (req, reply) => {
    const { id } = req.params as { id: string };
    const p = proposalsSvc.reject(id);
    if (!p) return reply.code(404).send({ error: "предложение не найдено" });
    return p;
  });
```
> `documentsSvc` уже создан в `buildApp` (План 1). Не переименовывай.

- [ ] **Step 4: Тесты зелёные + полный прогон**

Run: `pnpm --filter @master-ai/server test app && pnpm -r test && pnpm -r typecheck`
Expected: PASS везде.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/app.test.ts
git commit -m "master-ai: эндпоинты брейнсторма и апрувов"
```

---

### Task 6: Workshop — чат и очередь апрувов на странице кампании

**Files:**
- Modify: `packages/web/src/api/client.ts` (добавить методы)
- Create: `packages/web/src/pages/WorkshopPanel.tsx`
- Modify: `packages/web/src/pages/CampaignPage.tsx`
- Test: `packages/web/src/pages/WorkshopPanel.test.tsx`

**Interfaces:**
- Consumes: `api` (расширенный), `useToast`, `Proposal`/`BrainstormResponse`/`ConversationMessage` (shared).
- Produces:
  - В `api` (client.ts) новые методы: `brainstorm(campaignId, message): Promise<BrainstormResponse>`, `listProposals(campaignId, status?): Promise<Proposal[]>`, `approveProposal(id): Promise<Document>`, `rejectProposal(id): Promise<Proposal>`, `getConversation(campaignId): Promise<ConversationMessage[]>`.
  - `WorkshopPanel({ campaignId, onApproved })` — поле ввода + кнопка «Отправить» (зовёт `api.brainstorm`, показывает реплику ассистента и историю), список pending-предложений с кнопками «Принять»/«Отклонить» (зовут approve/reject; после принятия — `onApproved()`); ошибки → тост.
  - `CampaignPage` рендерит `<WorkshopPanel campaignId={campaignId} onApproved={refreshDocuments} />` (после апрува список документов обновляется).

- [ ] **Step 1: Добавить методы в api client**

В `packages/web/src/api/client.ts` импортировать типы `Proposal, BrainstormResponse, ConversationMessage` из `@master-ai/shared` и добавить в объект `api`:
```ts
  brainstorm: (campaignId: string, message: string) =>
    request<BrainstormResponse>(`/api/campaigns/${campaignId}/brainstorm`, { method: "POST", body: JSON.stringify({ message }) }),
  listProposals: (campaignId: string, status?: string) =>
    request<Proposal[]>(`/api/campaigns/${campaignId}/proposals${status ? `?status=${status}` : ""}`),
  approveProposal: (id: string) =>
    request<Document>(`/api/proposals/${id}/approve`, { method: "POST" }),
  rejectProposal: (id: string) =>
    request<Proposal>(`/api/proposals/${id}/reject`, { method: "POST" }),
  getConversation: (campaignId: string) =>
    request<ConversationMessage[]>(`/api/campaigns/${campaignId}/conversation`),
```

- [ ] **Step 2: Падающий тест WorkshopPanel**

`packages/web/src/pages/WorkshopPanel.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "../ui/toast.js";
import { WorkshopPanel } from "./WorkshopPanel.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js");
beforeEach(() => vi.resetAllMocks());

function renderPanel(onApproved = vi.fn()) {
  return render(
    <ToastProvider>
      <WorkshopPanel campaignId="c1" onApproved={onApproved} />
    </ToastProvider>,
  );
}

describe("WorkshopPanel", () => {
  it("отправляет сообщение и показывает предложение, принимает его", async () => {
    vi.mocked(api.getConversation).mockResolvedValue([]);
    vi.mocked(api.listProposals).mockResolvedValue([]);
    vi.mocked(api.brainstorm).mockResolvedValue({
      conversationId: "k1",
      reply: "Вот злодей.",
      proposals: [{ id: "p1", campaignId: "c1", conversationId: "k1", type: "npc", title: "Барон", content: "Мрачный.", fields: {}, status: "pending", createdAt: "x" }],
    });
    vi.mocked(api.approveProposal).mockResolvedValue({
      id: "d1", campaignId: "c1", type: "npc", title: "Барон", status: null, contentJson: null, fields: {}, createdAt: "x", updatedAt: "x",
    });
    const onApproved = vi.fn();
    renderPanel(onApproved);

    await userEvent.type(screen.getByLabelText(/сообщение/i), "придумай злодея");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));

    expect(await screen.findByText("Вот злодей.")).toBeInTheDocument();
    expect(await screen.findByText("Барон")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /принять/i }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith("p1"));
    expect(onApproved).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/web test WorkshopPanel`
Expected: FAIL — `./WorkshopPanel.js` не найден.

- [ ] **Step 4: Реализовать WorkshopPanel**

`packages/web/src/pages/WorkshopPanel.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { ConversationMessage, Proposal } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function WorkshopPanel({ campaignId, onApproved }: { campaignId: string; onApproved: () => void }) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConversation(campaignId).then(setMessages).catch(() => showToast("Не удалось загрузить беседу"));
    api.listProposals(campaignId, "pending").then(setProposals).catch(() => showToast("Не удалось загрузить предложения"));
  }, [campaignId, showToast]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.brainstorm(campaignId, input.trim());
      setMessages(await api.getConversation(campaignId));
      setProposals((prev) => [...prev, ...res.proposals]);
      setInput("");
    } catch {
      showToast("Не удалось получить ответ ИИ");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    try {
      await api.approveProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
      onApproved();
    } catch {
      showToast("Не удалось принять предложение");
    }
  }

  async function reject(id: string) {
    try {
      await api.rejectProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } catch {
      showToast("Не удалось отклонить предложение");
    }
  }

  return (
    <section className="workshop">
      <h2>Мастерская</h2>
      <div className="chat">
        {messages.map((m) => (
          <p key={m.id}><strong>{m.role === "user" ? "Вы" : "ИИ"}:</strong> {m.content}</p>
        ))}
      </div>
      <form onSubmit={send}>
        <label htmlFor="brainstorm-input">Сообщение</label>
        <input id="brainstorm-input" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={busy}>Отправить</button>
      </form>

      {proposals.length > 0 && (
        <div className="proposals">
          <h3>Предложения</h3>
          {proposals.map((p) => (
            <div key={p.id} className="proposal">
              <strong>{p.title}</strong> <em>({p.type})</em>
              <p>{p.content}</p>
              <button type="button" onClick={() => approve(p.id)}>Принять</button>
              <button type="button" onClick={() => reject(p.id)}>Отклонить</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Встроить в CampaignPage**

В `packages/web/src/pages/CampaignPage.tsx`:
- импортировать `WorkshopPanel` (`./WorkshopPanel.js`);
- вынести загрузку документов в функцию `loadDocuments()` (чтобы переиспользовать) и вызывать её в `useEffect`;
- отрендерить `<WorkshopPanel campaignId={campaignId!} onApproved={loadDocuments} />` (например, над дашбордом документов).
> Не сломай существующий тест CampaignPage (он уже обёрнут в ToastProvider и мокает api — добавь в его мок `getConversation`/`listProposals`, возвращающие пустые массивы, чтобы WorkshopPanel не падал).

- [ ] **Step 6: Полный web-набор + typecheck**

Run: `pnpm --filter @master-ai/web test && pnpm --filter @master-ai/web typecheck`
Expected: PASS (WorkshopPanel + обновлённый CampaignPage + остальные).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src
git commit -m "master-ai: Workshop — чат брейнсторма и очередь апрувов"
```

---

### Task 7: Сквозная проверка брейнсторма

**Files:** (только проверка)

- [ ] **Step 1: Поднять стек с подставной LLM, возвращающей json-блок**

Подставная команда печатает реплику с json-блоком. Создай файл-фикстуру (путь без пробелов) с содержимым:
```
Вот идея.

```json
{"proposals":[{"type":"npc","title":"Барон фон Кройц","content":"Мрачный аристократ, скрывающий тайну."}]}
```
```
Запусти бэкенд: `MASTER_AI_LLM_CMD=cat MASTER_AI_LLM_ARGS=<путь-к-фикстуре> pnpm --filter @master-ai/server dev`.

- [ ] **Step 2: Прогнать сценарий через API**

```bash
# создать кампанию
CID=$(curl -s -X POST http://127.0.0.1:5174/api/campaigns -H 'content-type: application/json' -d '{"name":"E2E"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
# брейнсторм
curl -s -X POST http://127.0.0.1:5174/api/campaigns/$CID/brainstorm -H 'content-type: application/json' -d '{"message":"злодей"}'
```
Expected: ответ содержит `reply` (без ```` ``` ````) и `proposals[0].title == "Барон фон Кройц"` без порчи кириллицы. Затем апрув предложения и проверка, что документ появился в `/api/campaigns/$CID/documents`. Остановить сервер.

- [ ] **Step 3: Полные гейты монорепо**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 4: Commit (если правок не было — пропустить)**

---

## Self-Review

**Покрытие (План 5 — брейнсторм + апрувы):**
- Типы Proposal/Conversation → Task 1. ✅
- Таблицы + миграция → Task 2. ✅
- Сервисы беседы/предложений (approve→документ) → Task 3. ✅
- parseProposals + BrainstormService → Task 4. ✅
- Эндпоинты → Task 5. ✅
- Workshop-UI (чат + апрувы) → Task 6. ✅
- Сквозная проверка → Task 7. ✅
- Поиск/линковка — План 6. ✅

**Заглушки:** нет — полный код или конкретная команда в каждом шаге.

**Согласованность типов:** `DraftProposal`/`Proposal`/`BrainstormResponse`/`ConversationMessage` (Task 1) используются в сервисах (Tasks 3–4), эндпоинтах (Task 5) и фронте (Task 6); `parseProposals` (Task 4) → `BrainstormService`; `BrainstormService.respond` → эндпоинт; `textToDoc`/`approve` создают `Document` через существующий `DocumentService`. `buildApp({ db, llm })` не меняет сигнатуру. ✅
