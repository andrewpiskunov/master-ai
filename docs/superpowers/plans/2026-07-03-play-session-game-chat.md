# Редизайн режима игры: игровой чат с ИИ-мастером — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить экран `PlaySession`: в центре — чат с ИИ-мастером (действия вводятся от лица персонажа, выбранного чипом; ответы — блоками «Прочитай игрокам»/«Скрытое для мастера»), справа — автоматический лог событий с навигацией к сообщениям и вкладки «Сценарий / Документы / Бой».

**Architecture:** Новый клиентский компонент `GameChat` + панель лога; сервер переиспользует фоновые задачи `AssistantJobService` и беседы (`conversations`/`messages`). У сообщений появляется JSON-колонка `meta` (актор у сообщений мастера, запись лога у ответов ИИ). Парсинг игровых секций и log-блока — в `@master-ai/shared` (используют и сервер, и веб). Разбор блоков ассистента (`doc`/`new-doc`/`edit-doc`) выносится из `DocumentAssistant.tsx` в общие модули.

**Tech Stack:** React 18 + Vite (packages/web), Fastify 5 + better-sqlite3 + Drizzle (packages/server), Zod-схемы и типы в packages/shared, vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-play-session-redesign-design.md`

## Global Constraints

- Весь UI-текст и комментарии в коде — по-русски (стиль репозитория).
- Коммиты БЕЗ `Co-Authored-By` (правило CLAUDE.md), сообщения коммитов по-русски.
- Миграции drizzle пишутся вручную: SQL-файл + запись в `packages/server/drizzle/meta/_journal.json` (конвенция проекта, см. 0003–0007).
- Один CSS-файл `packages/web/src/styles.css`, CSS-переменные, без библиотек компонентов.
- Вкладки правой колонки всегда смонтированы, переключение через `display:none` (паттерн проекта — не терять состояние).
- Не трогать: `CombatTracker.tsx`, `PlayPanel.tsx`/`PlayMaterials`, Мастерскую, провайдеры LLM.
- Команды: `pnpm --filter @master-ai/shared test`, `pnpm --filter @master-ai/server test`, `pnpm --filter @master-ai/web test`, `pnpm -r typecheck`. Все запускать из корня репо `/Users/andrew/Documents/Personal-Super-Agent-Ru/Docs/НРИ/master-ai`.
- Dev-сервер держит SQLite в WAL — не писать в файл БД напрямую, пока он запущен.

---

### Task 1: Shared — парсинг игрового ответа (`game.ts`)

**Files:**
- Create: `packages/shared/src/game.ts`
- Create: `packages/shared/src/game.test.ts`
- Modify: `packages/shared/src/index.ts` (добавить экспорт)

**Interfaces:**
- Produces: `GameLogEntry { title: string; important: boolean }`, `MessageMeta { actorId?: string; actorName?: string; actorKind?: "pc" | "npc" | "master"; log?: GameLogEntry }`, `extractLogBlock(text: string): { log: GameLogEntry | null; rest: string }`, `fallbackLogTitle(action: string, max?: number): string`, `parseGameSections(text: string): { intro: string; read: string | null; hidden: string | null }` — всё экспортируется из `@master-ai/shared`.

- [ ] **Step 1: Написать падающие тесты**

Создать `packages/shared/src/game.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractLogBlock, fallbackLogTitle, parseGameSections } from "./game.js";

describe("extractLogBlock", () => {
  it("вырезает закрытый log-блок и парсит JSON", () => {
    const text = "## Прочитай игрокам\nЗамок щёлкает.\n```log\n{\"title\": \"Алдар взломал замок\", \"important\": true}\n```";
    const { log, rest } = extractLogBlock(text);
    expect(log).toEqual({ title: "Алдар взломал замок", important: true });
    expect(rest).not.toContain("```log");
    expect(rest).toContain("Замок щёлкает.");
  });

  it("незакрытый блок во время стрима — прячет хвост, log null", () => {
    const { log, rest } = extractLogBlock("Текст ответа\n```log\n{\"title\": \"обры");
    expect(log).toBeNull();
    expect(rest).toBe("Текст ответа\n");
  });

  it("битый JSON — блок вырезан, log null", () => {
    const { log, rest } = extractLogBlock("Ответ\n```log\nне json\n```");
    expect(log).toBeNull();
    expect(rest).toBe("Ответ");
  });

  it("без блока — текст как есть", () => {
    expect(extractLogBlock("Просто ответ")).toEqual({ log: null, rest: "Просто ответ" });
  });

  it("important не-boolean трактуется как false", () => {
    const { log } = extractLogBlock("```log\n{\"title\": \"Событие\", \"important\": \"да\"}\n```");
    expect(log).toEqual({ title: "Событие", important: false });
  });
});

describe("fallbackLogTitle", () => {
  it("короткое действие возвращается как есть", () => {
    expect(fallbackLogTitle("взламывает замок")).toBe("взламывает замок");
  });
  it("длинное — обрезается с многоточием", () => {
    const t = fallbackLogTitle("а".repeat(100));
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("parseGameSections", () => {
  it("делит на «Прочитай игрокам» и «Скрытое для мастера»", () => {
    const s = parseGameSections("Вступление.\n## Прочитай игрокам\nДверь отворяется.\n## Скрытое для мастера\nЗа дверью ловушка.");
    expect(s.intro).toBe("Вступление.");
    expect(s.read).toBe("Дверь отворяется.");
    expect(s.hidden).toBe("За дверью ловушка.");
  });

  it("ответ без секций — всё в intro", () => {
    const s = parseGameSections("Сложность проверки — 14.");
    expect(s).toEqual({ intro: "Сложность проверки — 14.", read: null, hidden: null });
  });

  it("терпит ### и вариации заголовка скрытой секции", () => {
    const s = parseGameSections("### Прочитай игрокам\nТекст.\n### Скрытая информация для мастера\nТайна.");
    expect(s.read).toBe("Текст.");
    expect(s.hidden).toBe("Тайна.");
  });

  it("только читаемая секция — hidden null", () => {
    const s = parseGameSections("## Прочитай игрокам\nВы входите в зал.");
    expect(s.read).toBe("Вы входите в зал.");
    expect(s.hidden).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter @master-ai/shared test`
Expected: FAIL — `Cannot find module './game.js'` (или аналог).

- [ ] **Step 3: Реализация**

Создать `packages/shared/src/game.ts`:

```ts
// Игровой чат режима игры: метаданные сообщений и разбор ответа ИИ-мастера.

export interface GameLogEntry {
  title: string;
  important: boolean;
}

// Метаданные сообщения (messages.meta): у сообщения мастера — от чьего лица
// действие; у ответа ИИ на действие — запись лога событий.
export interface MessageMeta {
  actorId?: string;
  actorName?: string;
  actorKind?: "pc" | "npc" | "master";
  log?: GameLogEntry;
}

// Вырезает служебный блок ```log {"title":…,"important":…}``` из ответа ИИ.
// Незакрытый блок (стрим ещё идёт) — прячем хвост; битый JSON — блок убираем, log null.
export function extractLogBlock(text: string): { log: GameLogEntry | null; rest: string } {
  const fence = /```log\s*\n?([\s\S]*?)```/.exec(text);
  if (!fence) {
    const open = text.indexOf("```log");
    if (open >= 0) return { log: null, rest: text.slice(0, open) };
    return { log: null, rest: text };
  }
  const rest = text.replace(fence[0], "").trim();
  try {
    const parsed = JSON.parse(fence[1].trim()) as { title?: unknown; important?: unknown };
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return { log: { title: parsed.title.trim(), important: parsed.important === true }, rest };
    }
  } catch {
    // битый JSON — событие потеряно не будет: сервер подставит заголовок из действия
  }
  return { log: null, rest };
}

// Заголовок записи лога, когда ИИ не вернул log-блок: первые слова действия.
export function fallbackLogTitle(action: string, max = 60): string {
  const s = action.trim().replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// Делит ответ ИИ-мастера на вступление и секции «Прочитай игрокам» / «Скрытое для
// мастера» (заголовки ## или ###; «скрытая информация…» тоже принимается).
export function parseGameSections(text: string): { intro: string; read: string | null; hidden: string | null } {
  const buf: Record<"intro" | "read" | "hidden", string[]> = { intro: [], read: [], hidden: [] };
  let cur: "intro" | "read" | "hidden" = "intro";
  for (const line of text.split("\n")) {
    const m = /^#{2,3}\s*(.+?)\s*$/.exec(line.trim());
    if (m) {
      const h = m[1].toLowerCase();
      if (h.includes("прочитай игрокам")) { cur = "read"; continue; }
      if (h.includes("скрыт")) { cur = "hidden"; continue; }
    }
    buf[cur].push(line);
  }
  const join = (a: string[]) => a.join("\n").trim();
  return {
    intro: join(buf.intro),
    read: buf.read.length ? join(buf.read) : null,
    hidden: buf.hidden.length ? join(buf.hidden) : null,
  };
}
```

В `packages/shared/src/index.ts` добавить строку:

```ts
export * from "./game.js";
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @master-ai/shared test`
Expected: PASS (все, включая существующие).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/game.ts packages/shared/src/game.test.ts packages/shared/src/index.ts
git commit -m "Shared: разбор ответа ИИ-мастера — секции «Прочитай игрокам»/«Скрытое», log-блок, типы меты сообщений"
```

---

### Task 2: Сервер — колонка `messages.meta` и поддержка в ConversationService

**Files:**
- Create: `packages/server/drizzle/0008_message_meta.sql`
- Modify: `packages/server/drizzle/meta/_journal.json`
- Modify: `packages/server/src/db/schema.ts:36-42` (таблица messages)
- Modify: `packages/server/src/services/conversations.ts`
- Modify: `packages/shared/src/proposal.ts:33-38` (ConversationMessage)
- Test: `packages/server/src/services/conversations.test.ts`

**Interfaces:**
- Consumes: `MessageMeta` из Task 1.
- Produces: `ConversationMessage` получает поле `meta?: MessageMeta`; `ConversationService.addMessage(conversationId, role, content, meta?: MessageMeta)`; `ConversationService.updateMessageMeta(messageId: string, patch: Partial<MessageMeta>): ConversationMessage | null`; `listMessages` возвращает `meta`.

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/server/src/services/conversations.test.ts` внутрь `describe("ConversationService", …)`:

```ts
it("addMessage сохраняет meta; listMessages возвращает её; updateMessageMeta мерджит", () => {
  const s = svc();
  const { id } = s.getOrCreateForDocument("c1", "d1");
  s.addMessage(id, "user", "взламывает замок", { actorId: "p1", actorName: "Алдар", actorKind: "pc" });
  const a = s.addMessage(id, "assistant", "…", { log: { title: "Алдар взломал замок", important: false } });
  let msgs = s.listMessages(id);
  expect(msgs[0].meta?.actorName).toBe("Алдар");
  expect(msgs[1].meta?.log).toEqual({ title: "Алдар взломал замок", important: false });

  const upd = s.updateMessageMeta(a.id, { log: { title: "Алдар взломал замок", important: true } });
  expect(upd?.meta?.log?.important).toBe(true);
  msgs = s.listMessages(id);
  expect(msgs[1].meta?.log?.important).toBe(true);

  expect(s.updateMessageMeta("nope", { log: { title: "x", important: false } })).toBeNull();
});

it("сообщения без meta возвращают пустой объект", () => {
  const s = svc();
  const { id } = s.getOrCreateForCampaign("c1");
  s.addMessage(id, "user", "привет");
  expect(s.listMessages(id)[0].meta).toEqual({});
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @master-ai/server test -- conversations`
Expected: FAIL (нет колонки `meta` / метода `updateMessageMeta`).

- [ ] **Step 3: Миграция и схема**

Создать `packages/server/drizzle/0008_message_meta.sql`:

```sql
ALTER TABLE `messages` ADD `meta` text DEFAULT '{}' NOT NULL;
```

В `packages/server/drizzle/meta/_journal.json` добавить в массив `entries` после записи idx 7:

```json
    {
      "idx": 8,
      "version": "6",
      "when": 1782759200000,
      "tag": "0008_message_meta",
      "breakpoints": true
    }
```

В `packages/server/src/db/schema.ts` в таблицу `messages` добавить после `content`:

```ts
  // Метаданные игрового чата: актор действия / запись лога событий (JSON).
  meta: text("meta").notNull().default("{}"),
```

- [ ] **Step 4: Тип ConversationMessage**

В `packages/shared/src/proposal.ts` — импорт наверху файла и поле:

```ts
import type { MessageMeta } from "./game.js";
```

```ts
export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta?: MessageMeta;
}
```

- [ ] **Step 5: ConversationService**

В `packages/server/src/services/conversations.ts`:

Импорты:

```ts
import type { ConversationMessage, MessageMeta } from "@master-ai/shared";
```

Заменить `addMessage` и `listMessages`, добавить `updateMessageMeta` и приватный парсер:

```ts
  addMessage(conversationId: string, role: "user" | "assistant", content: string, meta?: MessageMeta): ConversationMessage {
    const row = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      meta: JSON.stringify(meta ?? {}),
      createdAt: new Date().toISOString(),
    };
    this.db.insert(messages).values(row).run();
    return { id: row.id, role, content, meta: meta ?? {}, createdAt: row.createdAt };
  }

  // Точечное обновление меты сообщения (например, переключение важности записи лога).
  updateMessageMeta(messageId: string, patch: Partial<MessageMeta>): ConversationMessage | null {
    const row = this.db.select().from(messages).where(eq(messages.id, messageId)).get();
    if (!row) return null;
    const meta = { ...parseMeta(row.meta), ...patch };
    this.db.update(messages).set({ meta: JSON.stringify(meta) }).where(eq(messages.id, messageId)).run();
    return { id: row.id, role: row.role as "user" | "assistant", content: row.content, meta, createdAt: row.createdAt };
  }
```

`listMessages` — в map добавить meta:

```ts
    return rows.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      meta: parseMeta(r.meta),
      createdAt: r.createdAt,
    }));
```

Вне класса (внизу файла):

```ts
// Мета хранится JSON-строкой; повреждённое значение не должно ронять выдачу беседы.
function parseMeta(raw: string): MessageMeta {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as MessageMeta) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 6: Тесты зелёные**

Run: `pnpm --filter @master-ai/server test`
Expected: PASS (все серверные тесты — миграция на `:memory:` накатывается в каждом тесте).

- [ ] **Step 7: Commit**

```bash
git add packages/server/drizzle/0008_message_meta.sql packages/server/drizzle/meta/_journal.json packages/server/src/db/schema.ts packages/server/src/services/conversations.ts packages/server/src/services/conversations.test.ts packages/shared/src/proposal.ts
git commit -m "Сервер: JSON-мета у сообщений беседы (актор действия, запись лога) + updateMessageMeta"
```

---

### Task 3: Сервер — игровой режим ассистента и PATCH меты сообщения

**Files:**
- Modify: `packages/server/src/app.ts:89-92` (схемы), `:335-354` (маршрут ассистента), после `:380` (новый PATCH)
- Test: `packages/server/src/app.test.ts`

**Interfaces:**
- Consumes: `extractLogBlock`, `fallbackLogTitle`, `MessageMeta` из shared; `conversationsSvc.addMessage(...meta)`, `updateMessageMeta` из Task 2.
- Produces: `POST /api/documents/:id/assistant` принимает `{ message, system?, mode?: "game", meta?: {actorId?, actorName?, actorKind?} }`; при game-режиме история для LLM префиксует действия `Действие (Имя): …`, а ответ ИИ на действие получает `meta.log` (из log-блока или fallback). Новый `PATCH /api/messages/:id/meta` с телом `{ log: { title, important } }` → обновлённый `ConversationMessage`.

- [ ] **Step 1: Написать падающие тесты**

В `packages/server/src/app.test.ts` добавить хелпер (рядом с `makeApp`) и тесты:

```ts
// Ждёт завершения фоновой генерации ассистента по документу.
async function waitAssistant(app: ReturnType<typeof buildApp>, docId: string) {
  for (let i = 0; i < 100; i++) {
    const st = (await app.inject({ method: "GET", url: `/api/documents/${docId}/assistant` })).json();
    if (!st.running) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("генерация не завершилась");
}
```

```ts
it("игровой режим: мета актора у вопроса, log-блок в мете ответа, PATCH важности", async () => {
  const { db } = createDb(":memory:");
  const reply =
    "## Прочитай игрокам\nЗамок щёлкает.\n## Скрытое для мастера\nЗа дверью ловушка.\n" +
    "```log\n{\"title\": \"Алдар взломал замок\", \"important\": false}\n```";
  const app = buildApp({ db, llm: new FakeProvider([reply]) });
  const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })).json();
  const s = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "session", title: "Сессия 1" } })).json();

  const started = await app.inject({
    method: "POST",
    url: `/api/documents/${s.id}/assistant`,
    payload: { message: "взламывает замок", mode: "game", meta: { actorId: "p1", actorName: "Алдар", actorKind: "pc" } },
  });
  expect(started.statusCode).toBe(202);
  await waitAssistant(app, s.id);

  const msgs = (await app.inject({ method: "GET", url: `/api/documents/${s.id}/conversation` })).json();
  expect(msgs[0].meta.actorName).toBe("Алдар");
  expect(msgs[1].meta.log).toEqual({ title: "Алдар взломал замок", important: false });

  const patched = await app.inject({
    method: "PATCH",
    url: `/api/messages/${msgs[1].id}/meta`,
    payload: { log: { title: "Алдар взломал замок", important: true } },
  });
  expect(patched.statusCode).toBe(200);
  expect(patched.json().meta.log.important).toBe(true);

  // Вопрос мастера — без записи лога.
  await app.inject({
    method: "POST",
    url: `/api/documents/${s.id}/assistant`,
    payload: { message: "какая сложность взлома?", mode: "game", meta: { actorKind: "master", actorName: "Мастер" } },
  });
  await waitAssistant(app, s.id);
  const msgs2 = (await app.inject({ method: "GET", url: `/api/documents/${s.id}/conversation` })).json();
  expect(msgs2).toHaveLength(4);
  expect(msgs2[3].meta.log).toBeUndefined();
});

it("игровой режим: без log-блока в ответе — заголовок записи из действия", async () => {
  const { db } = createDb(":memory:");
  const app = buildApp({ db, llm: new FakeProvider(["## Прочитай игрокам\nВы входите в зал."]) });
  const c = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "C" } })).json();
  const s = (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId: c.id, type: "session", title: "Сессия 1" } })).json();
  await app.inject({
    method: "POST",
    url: `/api/documents/${s.id}/assistant`,
    payload: { message: "Партия входит в тронный зал", mode: "game", meta: { actorName: "Мира", actorKind: "pc" } },
  });
  await waitAssistant(app, s.id);
  const msgs = (await app.inject({ method: "GET", url: `/api/documents/${s.id}/conversation` })).json();
  expect(msgs[1].meta.log).toEqual({ title: "Партия входит в тронный зал", important: false });
});

it("PATCH меты несуществующего сообщения → 404", async () => {
  const app = makeApp();
  const res = await app.inject({ method: "PATCH", url: "/api/messages/nope/meta", payload: { log: { title: "x", important: true } } });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `pnpm --filter @master-ai/server test -- app`
Expected: FAIL (мета не сохраняется, маршрута PATCH нет).

- [ ] **Step 3: Реализация в app.ts**

Импорт из shared (в существующую строку импортов из `@master-ai/shared` добавить):

```ts
import { extractLogBlock, fallbackLogTitle, type MessageMeta } from "@master-ai/shared";
```

(если импорт из shared в app.ts составной — дописать в него; проверить существующие импорты вверху файла.)

Рядом с `AssistantStartSchema` (строка ~92) заменить схему и добавить новую:

```ts
  const MessageMetaSchema = z.object({
    actorId: z.string().optional(),
    actorName: z.string().optional(),
    actorKind: z.enum(["pc", "npc", "master"]).optional(),
  });
  const AssistantStartSchema = z.object({
    message: z.string().min(1),
    system: z.string().optional(),
    // Игровой чат режима игры: история префиксуется актором, ответ получает мету лога.
    mode: z.literal("game").optional(),
    meta: MessageMetaSchema.optional(),
  });
  const MessageMetaPatchSchema = z.object({
    log: z.object({ title: z.string().min(1), important: z.boolean() }).optional(),
  });
```

В маршруте `POST /api/documents/:id/assistant` (строки ~343-352) заменить сохранение вопроса, историю и onFinish:

```ts
    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    conversationsSvc.addMessage(conv.id, "user", parsed.data.message, parsed.data.meta);
    // В LLM уходит только хвост беседы — полная история упирается в контекст модели.
    // Действия игрового чата префиксуются актором, чтобы ИИ видел, кто действует.
    const history = conversationsSvc.listMessages(conv.id).slice(-20).map((m) => ({
      role: m.role,
      content:
        m.role === "user" && m.meta?.actorName && m.meta.actorKind && m.meta.actorKind !== "master"
          ? `Действие (${m.meta.actorName}): ${m.content}`
          : m.content,
    }));
    const stream = llmFor(doc.campaignId).complete({ system: parsed.data.system, messages: history });
    // Действие персонажа всегда порождает запись лога: из log-блока ответа,
    // а если ИИ его не вернул — с заголовком из первых слов действия.
    const isAction = parsed.data.mode === "game" && !!parsed.data.meta?.actorKind && parsed.data.meta.actorKind !== "master";
    const actionText = parsed.data.message;
    assistantJobs.start(id, stream, (text) => {
      // Пока шла генерация, документ могли удалить — не создаём «висячий» ответ.
      if (!documentsSvc.get(id)) return;
      let meta: MessageMeta | undefined;
      if (isAction) {
        const { log } = extractLogBlock(text);
        meta = { log: log ?? { title: fallbackLogTitle(actionText), important: false } };
      }
      conversationsSvc.addMessage(conv.id, "assistant", text, meta);
    });
    return reply.code(202).send({ started: true });
```

После маршрута `POST /api/documents/:id/conversation/messages` (строка ~380) добавить:

```ts
  // Точечное обновление меты сообщения — переключение важности записи лога в режиме игры.
  app.patch("/api/messages/:id/meta", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = MessageMetaPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updated = conversationsSvc.updateMessageMeta(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "сообщение не найдено" });
    return updated;
  });
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @master-ai/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/app.test.ts
git commit -m "Сервер: игровой режим ассистента — актор в истории LLM, запись лога в мете ответа, PATCH важности"
```

---

### Task 4: Сервер — сводка сессии из игрового лога

**Files:**
- Modify: `packages/server/src/services/brainstorm.ts:195-214` (sessionSummary)
- Test: `packages/server/src/services/brainstorm.test.ts`

**Interfaces:**
- Consumes: `this.deps.conversations` (ConversationService, уже в deps), `meta.log` из Task 2.
- Produces: `sessionSummary` без изменения сигнатуры; вход LLM строится из лога событий игрового чата + хвоста чата, с fallback на `fields.sessionLog` (старые сессии).

- [ ] **Step 1: Написать падающий тест**

Дописать в `packages/server/src/app.test.ts`? Нет — в `packages/server/src/services/brainstorm.test.ts`, рядом с существующим тестом `sessionSummary` (строка ~68), по его образцу:

```ts
it("sessionSummary: лог из игрового чата приоритетнее fields.sessionLog; без чата — fallback", async () => {
  const { db } = createDb(":memory:");
  const docs = new DocumentService(db);
  const conv = new ConversationService(db);
  const inputs: string[] = [];
  const llm = {
    async *complete(input: { messages: { content: string }[] }) {
      inputs.push(input.messages[0].content);
      yield "ИТОГИ: Всё случилось.\nЗАДЕЛ:\n- Нить.";
    },
  };
  const svc = new BrainstormService({
    llmFor: () => llm as unknown as LLMProvider,
    conversations: conv, proposals: new ProposalService(db), documents: docs, campaigns: new CampaignService(db),
  });

  const s = docs.create({ campaignId: "c1", type: "session", title: "Сессия 1", fields: { sessionLog: "старый ручной лог" } });
  const cv = conv.getOrCreateForDocument("c1", s.id);
  conv.addMessage(cv.id, "user", "взламывает замок", { actorName: "Алдар", actorKind: "pc" });
  conv.addMessage(cv.id, "assistant", "Замок щёлкает.", { log: { title: "Алдар взломал замок", important: true } });
  await svc.sessionSummary(s.id);
  expect(inputs[0]).toContain("[важно] Алдар взломал замок");
  expect(inputs[0]).toContain("взламывает замок"); // хвост чата тоже уходит в сводку
  expect(inputs[0]).not.toContain("старый ручной лог");

  const s2 = docs.create({ campaignId: "c1", type: "session", title: "Сессия 2", fields: { sessionLog: "старый ручной лог" } });
  await svc.sessionSummary(s2.id);
  expect(inputs[1]).toContain("старый ручной лог");
});
```

(Импорты `ConversationService` и остальных сервисов в этом тест-файле уже есть — см. существующий тест на строках 68–80. Если типа `LLMProvider` нет в импортах — добавить `import type { LLMProvider } from "../llm/provider.js";`.)

- [ ] **Step 2: Убедиться, что тест падает**

Run: `pnpm --filter @master-ai/server test -- brainstorm`
Expected: FAIL — `inputs[0]` не содержит «Алдар взломал замок».

- [ ] **Step 3: Реализация**

В `packages/server/src/services/brainstorm.ts`, метод `sessionSummary`, заменить строку `const log = …sessionLog…` (строка ~202) и сообщение пользователя:

```ts
    // Лог событий игрового чата; для старых сессий — ручной текстовый лог из fields.
    const conv = this.deps.conversations.getOrCreateForDocument(sess.campaignId, sessionId);
    const msgs = this.deps.conversations.listMessages(conv.id);
    const gameLog = msgs
      .filter((m) => m.meta?.log)
      .map((m) => `- ${m.meta!.log!.important ? "[важно] " : ""}${m.meta!.log!.title}`)
      .join("\n");
    const legacy = typeof sess.fields?.sessionLog === "string" ? sess.fields.sessionLog : "";
    const log = (gameLog || legacy).slice(0, 4000);
    const chatTail = msgs.slice(-30)
      .map((m) => `${m.role === "user" ? "Мастер" : "ИИ"}: ${m.content}`)
      .join("\n")
      .slice(0, 4000);
    const text = proseMirrorToText(sess.contentJson).trim().slice(0, 4000);
```

И в `messages` запроса к LLM:

```ts
      messages: [{ role: "user", content: `Лог сессии:\n${log || "(пусто)"}\n\nХод игры (чат с ИИ-мастером):\n${chatTail || "(пусто)"}\n\nЗаметки сессии:\n${text || "(пусто)"}` }],
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @master-ai/server test`
Expected: PASS (в т.ч. старый тест sessionSummary — у него беседа пуста, срабатывает fallback на sessionLog).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/brainstorm.ts packages/server/src/services/brainstorm.test.ts
git commit -m "Сводка сессии строится из игрового лога и чата с ИИ-мастером (fallback на старый ручной лог)"
```

---

### Task 5: Веб — методы API-клиента

**Files:**
- Modify: `packages/web/src/api/client.ts:95-103`

**Interfaces:**
- Consumes: маршруты из Task 3; типы `MessageMeta`, `GameLogEntry`, `ConversationMessage` из shared.
- Produces: `api.startAssistant(docId, message, system?, opts?: { mode?: "game"; meta?: MessageMeta })`; `api.updateMessageMeta(messageId: string, patch: { log: GameLogEntry }): Promise<ConversationMessage>`.

- [ ] **Step 1: Реализация**

В `packages/web/src/api/client.ts` — в импорт типов из `@master-ai/shared` добавить `MessageMeta` и `GameLogEntry`; заменить `startAssistant` и добавить `updateMessageMeta`:

```ts
  // Серверная генерация помощника документа: старт / статус / остановка.
  // opts.mode="game" + opts.meta — игровой чат режима игры (актор действия).
  startAssistant: (docId: string, message: string, system?: string, opts?: { mode?: "game"; meta?: MessageMeta }) =>
    request<{ started: boolean }>(`/api/documents/${docId}/assistant`, {
      method: "POST",
      body: JSON.stringify({ message, system, ...opts }),
    }),
```

После `stopAssistant`:

```ts
  // Переключение важности записи лога в игровом чате.
  updateMessageMeta: (messageId: string, patch: { log: GameLogEntry }) =>
    request<ConversationMessage>(`/api/messages/${messageId}/meta`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
```

- [ ] **Step 2: Проверка**

Run: `pnpm --filter @master-ai/web typecheck && pnpm --filter @master-ai/web test`
Expected: PASS (существующие вызовы `startAssistant(docId, text, system)` совместимы — параметр opts опционален).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/client.ts
git commit -m "API-клиент: игровой режим startAssistant и updateMessageMeta"
```

---

### Task 6: Веб — вынос разбора и карточек ассистента в общие модули

**Files:**
- Create: `packages/web/src/pages/assistant-blocks.ts`
- Create: `packages/web/src/pages/AssistantAnswer.tsx`
- Modify: `packages/web/src/pages/DocumentAssistant.tsx`
- Modify: `packages/web/src/pages/PlaySession.tsx:12` (импорт blockKey/NewEntity)

Поведение НЕ меняется — это подготовка к переиспользованию в GameChat.

**Interfaces:**
- Produces (из `assistant-blocks.ts`): `blockKey(block: string): string`; типы `NewEntity { type; title; text }`, `EditEntity { title; rename?; text? }`; `parseAssistant(content: string): { intro: string; doc: string | null; newDocs: NewEntity[]; edits: EditEntity[] }`; `entityBlocksPrompt(documents: { title: string; type: string }[]): string`.
- Produces (из `AssistantAnswer.tsx`): компонент `AssistantAnswer({ content, stale, currentText, appliedBlocks, documents, onApply, onCreateEntity, onEditEntity, renderIntro? })` — рендерит intro (через `renderIntro` или `<Markdown>`), карточку diff для ```doc```-блока, карточки new-doc/edit-doc с оптимистичными отметками (состояние per-message внутри компонента).

- [ ] **Step 1: Создать `assistant-blocks.ts`**

Перенести из `DocumentAssistant.tsx` БЕЗ изменений логики: `blockKey` (строки 21-26), `dequote` (28), `parseEdits` (31-47), `parseNewDoc` (50-59), `parseAssistant` (63-89), типы `NewEntity`/`EditEntity` (15-16), константу `TYPE_LIST` (91). Добавить `entityBlocksPrompt` — дословно вынесенный кусок системного промпта (из строк 276-289 DocumentAssistant.tsx):

```ts
import { DOCUMENT_TYPES, getDocumentType } from "@master-ai/shared";

export interface NewEntity { type: string; title: string; text: string }
export interface EditEntity { title: string; rename?: string; text?: string }

// … перенесённые blockKey, dequote, parseEdits, parseNewDoc, parseAssistant (экспортировать blockKey и parseAssistant) …

const TYPE_LIST = DOCUMENT_TYPES.map((t) => `${t.key} (${t.label})`).join(", ");

// Общая часть системного промпта про блоки new-doc/edit-doc — используется
// помощником документа и игровым чатом режима игры.
export function entityBlocksPrompt(documents: { title: string; type: string }[]): string {
  return (
    `Когда пользователь просит СОЗДАТЬ новую сущность (например «сделай из этой заметки персонажа», ` +
    `«создай NPC», «добавь локацию») — НЕ переписывай текущий документ. Вместо этого предложи новую сущность ` +
    `блоком \`\`\`new-doc и \`\`\` строго в формате:\n` +
    `type: <ключ типа из списка>\ntitle: <короткое название, 1–3 слова, без кавычек>\n---\n<описание сущности обычным текстом>\n` +
    `Доступные типы: ${TYPE_LIST}. Для персонажа игрока используй pc, для прочих персонажей — npc. ` +
    `Для npc и pc давай полное имя — имя и фамилию (или родовое прозвище), а не одно голое имя: «Гаст Двукоготь», а не «Гаст». ` +
    `Вне блока коротко поясни, что предлагаешь создать.\n\n` +
    `Когда пользователь просит ИЗМЕНИТЬ, ПЕРЕИМЕНОВАТЬ или ОБНОВИТЬ уже существующие документы ` +
    `(например «добавь всем NPC фамилии», «переименуй X», «обнови описание Y») — НЕ создавай новые. ` +
    `Для КАЖДОГО изменяемого документа верни отдельный блок \`\`\`edit-doc и \`\`\` строго в формате:\n` +
    `title: <точное название существующего документа из списка ниже>\nrename: <новое название> (только если меняешь имя)\n---\n<полный новый текст документа> (только если меняешь содержимое; иначе оставь пустым)\n` +
    `Можно вернуть несколько блоков edit-doc подряд. Существующие документы кампании: ` +
    `${documents.slice(0, 100).map((d) => `«${d.title}» (${getDocumentType(d.type)?.label ?? d.type})`).join(", ") || "(пока нет)"}.\n\n` +
    `Если правка не нужна — отвечай обычным текстом без блоков.`
  );
}
```

- [ ] **Step 2: Создать `AssistantAnswer.tsx`**

Перенести `DiffPreview` (DocumentAssistant.tsx:95-119) дословно и собрать компонент из JSX-рендера ответа (строки 343-403) с предикатами (301-326):

```tsx
import { useState, type ReactNode } from "react";
import { Check, Pencil, Plus } from "lucide-react";
import { plural } from "../format.js";
import { markdownToDoc } from "../editor/DocumentEditor.js";
import { pmText } from "../prosemirror-text.js";
import { lineDiff } from "../lineDiff.js";
import { Markdown } from "../ui/Markdown.js";
import { TypeTag } from "./campaign/shared.js";
import { blockKey, parseAssistant, type EditEntity, type NewEntity } from "./assistant-blocks.js";

// … DiffPreview дословно из DocumentAssistant.tsx …

// Тело ответа ассистента: вступление + карточки doc/new-doc/edit-doc.
// renderIntro позволяет игровому чату отрисовать секции «Прочитай игрокам»/«Скрытое».
export function AssistantAnswer({
  content, stale, currentText, appliedBlocks, documents,
  onApply, onCreateEntity, onEditEntity, renderIntro,
}: {
  content: string;
  stale: boolean;
  currentText: string;
  appliedBlocks: string[];
  documents: { title: string; type: string }[];
  onApply: (text: string) => void;
  onCreateEntity: (entity: NewEntity) => void;
  onEditEntity: (edit: EditEntity) => void;
  renderIntro?: (intro: string) => ReactNode;
}) {
  // Оптимистичные отметки «применено/создано/обновлено» — состояние на карточку-сообщение.
  const [appliedLocal, setAppliedLocal] = useState<Set<string>>(() => new Set());
  const [createdLocal, setCreatedLocal] = useState<Set<string>>(() => new Set());
  const [editedLocal, setEditedLocal] = useState<Set<string>>(() => new Set());
  const { intro, doc, newDocs, edits } = parseAssistant(content);

  const isApplied = (block: string): boolean => {
    if (appliedLocal.has(block)) return true;
    if (appliedBlocks.includes(blockKey(block))) return true;
    try { return pmText(markdownToDoc(block)).trim() === currentText; } catch { return false; }
  };
  const entityKey = (e: NewEntity) => `${e.type}:${e.title.trim().toLowerCase()}`;
  const isCreated = (nd: NewEntity): boolean =>
    createdLocal.has(entityKey(nd)) || documents.some((d) => d.title.trim().toLowerCase() === nd.title.trim().toLowerCase());
  const editKey = (e: EditEntity) => `${e.title.trim().toLowerCase()}→${(e.rename ?? "").trim().toLowerCase()}`;
  const isEdited = (e: EditEntity): boolean =>
    editedLocal.has(editKey(e)) || (!!e.rename && documents.some((d) => d.title.trim().toLowerCase() === e.rename!.trim().toLowerCase()));

  return (
    <>
      {intro && (renderIntro ? renderIntro(intro) : <Markdown>{intro}</Markdown>)}
      {/* дальше — дословно перенесённый JSX карточек doc / newDocs / edits из
          DocumentAssistant.tsx:351-402, где isStale(m) заменён на проп stale */}
    </>
  );
}
```

(JSX карточек переносится дословно; единственные замены: `isStale(m)` → `stale`, ссылки на локальные сеты — на новые useState выше.)

- [ ] **Step 3: Ужать DocumentAssistant.tsx**

- Удалить перенесённые: типы NewEntity/EditEntity (оставить `export type { NewEntity, EditEntity } from "./assistant-blocks.js";` НЕ нужно — см. ниже), `blockKey`, `dequote`, `parseEdits`, `parseNewDoc`, `parseAssistant`, `TYPE_LIST`, `DiffPreview`, состояния `appliedLocal`/`createdLocal`/`editedLocal`, предикаты `isApplied`/`isCreated`/`isEdited` и ключи.
- Добавить импорты: `import { entityBlocksPrompt, parseAssistant, type EditEntity, type NewEntity } from "./assistant-blocks.js";` и `import { AssistantAnswer } from "./AssistantAnswer.js";`
- Для обратной совместимости импортов других файлов добавить реэкспорт: `export { blockKey } from "./assistant-blocks.js"; export type { NewEntity, EditEntity } from "./assistant-blocks.js";` — либо (предпочтительно) обновить импорты в `PlaySession.tsx:12`:

```ts
import { DocumentAssistant } from "./DocumentAssistant.js";
import { blockKey, type NewEntity } from "./assistant-blocks.js";
```

- В системном промпте `send()` (строки 276-289) заменить new-doc/edit-doc часть вызовом `entityBlocksPrompt(documents)`:

```ts
            `Когда пользователь просит изменить, переписать или дополнить ЭТОТ документ — верни ПОЛНУЮ новую версию ` +
            `текста документа внутри блока \`\`\`doc и \`\`\` (обычный текст; при необходимости «## Заголовок», списки «- »). ` +
            `Вне блока коротко, по-русски, поясни, что изменил.\n\n` +
            entityBlocksPrompt(documents)
```

- Рендер ответа (строки 343-403) заменить на:

```tsx
          return (
            <div key={i} className="msg msg-assistant">
              <div className="msg-role">ИИ</div>
              {m.content ? (
                <AssistantAnswer
                  content={m.content}
                  stale={isStale(m)}
                  currentText={currentText}
                  appliedBlocks={appliedBlocks ?? []}
                  documents={documents}
                  onApply={onApply}
                  onCreateEntity={onCreateEntity}
                  onEditEntity={onEditEntity}
                />
              ) : (
                <div className="typing" aria-label="ИИ печатает"><span></span><span></span><span></span></div>
              )}
            </div>
          );
```

- `currentText` и `isStale` остаются в DocumentAssistant (isStale зависит от сообщения). В кнопке «Очистить беседу» убрать `setAppliedLocal(new Set())` (состояние теперь живёт в карточках), в effect загрузки убрать `setAppliedLocal(new Set())`.

- [ ] **Step 4: Проверка (рефакторинг без изменения поведения)**

Run: `pnpm --filter @master-ai/web typecheck && pnpm --filter @master-ai/web test && pnpm --filter @master-ai/server typecheck`
Expected: PASS, ноль изменений поведения (ручная быстрая проверка помощника — в Task 9).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/assistant-blocks.ts packages/web/src/pages/AssistantAnswer.tsx packages/web/src/pages/DocumentAssistant.tsx packages/web/src/pages/PlaySession.tsx
git commit -m "Рефакторинг: разбор и карточки ответа ассистента вынесены в assistant-blocks/AssistantAnswer для переиспользования"
```

---

### Task 7: Веб — компонент GameChat (чат, чипы акторов, лог-панель)

**Files:**
- Create: `packages/web/src/pages/GameChat.tsx`

**Interfaces:**
- Consumes: `api.startAssistant(..., { mode: "game", meta })`, `api.updateMessageMeta`, `api.getDocumentConversation`, `api.assistantStatus`, `api.stopAssistant` (Task 5); `extractLogBlock`, `parseGameSections`, `MessageMeta` (Task 1); `AssistantAnswer`, `NewEntity`, `EditEntity` (Task 6); `MentionTextarea`.
- Produces:
  - `interface Actor { kind: "pc" | "npc" | "master"; id: string | null; name: string }`
  - `interface GameMsg { id?: string; role: "user" | "assistant"; content: string; createdAt?: string; meta?: MessageMeta }`
  - `useGameChat(docId: string, onAssistantMessage?: (content: string) => void)` → `{ messages: GameMsg[]; busy: boolean; send(text: string, actor: Actor, system: string): Promise<void>; stop(): void; toggleImportant(messageId: string): Promise<void> }`; тип `GameChatState = ReturnType<typeof useGameChat>`
  - `GameChat({ chat, pcs, npcs, documents, buildSystem, playerView, currentText, appliedBlocks, docUpdatedAt, onApply, onCreateEntity, onEditEntity })`
  - `GameLogPanel({ messages, onJump, onToggleImportant })`
  - Каждое сообщение в ленте имеет `data-msg-id={m.id}` — для перехода из лога.

- [ ] **Step 1: Реализация**

Создать `packages/web/src/pages/GameChat.tsx` (полный файл):

```tsx
import { useEffect, useRef, useState } from "react";
import { BookOpen, Lock, Plus, Send, Square, Star, User } from "lucide-react";
import { extractLogBlock, parseGameSections, type MessageMeta } from "@master-ai/shared";
import { api } from "../api/client.js";
import { Markdown } from "../ui/Markdown.js";
import { MentionTextarea } from "../ui/MentionTextarea.js";
import { useToast } from "../ui/toast.js";
import { AssistantAnswer } from "./AssistantAnswer.js";
import type { EditEntity, NewEntity } from "./assistant-blocks.js";

export interface Actor { kind: "pc" | "npc" | "master"; id: string | null; name: string }
export interface GameMsg { id?: string; role: "user" | "assistant"; content: string; createdAt?: string; meta?: MessageMeta }

const MASTER: Actor = { kind: "master", id: null, name: "Мастер" };

// Состояние игрового чата: живёт в PlaySession, чтобы лог-панель в правой
// колонке строилась из тех же сообщений (один источник правды).
export function useGameChat(docId: string, onAssistantMessage?: (content: string) => void) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<GameMsg[]>([]);
  const [busy, setBusy] = useState(false);
  // Токен активного опроса: новый запуск или смена документа гасят старый цикл.
  const pollTokenRef = useRef(0);

  async function pollJob(notify: boolean): Promise<void> {
    const token = ++pollTokenRef.current;
    for (;;) {
      let st: { running: boolean; partial: string; error: string | null };
      try {
        st = await api.assistantStatus(docId);
      } catch {
        st = { running: false, partial: "", error: "нет связи с сервером" };
      }
      if (token !== pollTokenRef.current) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content: st.partial }];
      });
      if (!st.running) {
        if (st.error) showToast("Не удалось получить ответ ИИ");
        const msgs = await api.getDocumentConversation(docId).catch(() => null);
        if (token !== pollTokenRef.current) return;
        if (msgs) {
          setMessages(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, meta: m.meta })));
          const last = msgs[msgs.length - 1];
          if (notify && last?.role === "assistant") onAssistantMessage?.(last.content);
        }
        setBusy(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      if (token !== pollTokenRef.current) return;
    }
  }

  // История беседы сессии хранится на сервере; идущую генерацию подхватываем.
  useEffect(() => {
    let cancelled = false;
    api.getDocumentConversation(docId)
      .then(async (msgs) => {
        if (cancelled) return;
        setMessages(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, meta: m.meta })));
        const st = await api.assistantStatus(docId).catch(() => null);
        if (cancelled || !st?.running) return;
        setMessages((prev) => [...prev, { role: "assistant", content: st.partial }]);
        setBusy(true);
        void pollJob(true);
      })
      .catch(() => {});
    return () => { cancelled = true; pollTokenRef.current++; };
  // pollJob намеренно вне зависимостей: пересоздаётся каждый рендер, цикл держится за токен
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  async function send(text: string, actor: Actor, system: string) {
    const t = text.trim();
    if (!t || busy) return;
    const meta: MessageMeta = actor.kind === "master"
      ? { actorKind: "master", actorName: "Мастер" }
      : { actorKind: actor.kind, actorName: actor.name, actorId: actor.id ?? undefined };
    setMessages((prev) => [...prev, { role: "user", content: t, meta }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await api.startAssistant(docId, t, system, { mode: "game", meta });
      await pollJob(true);
    } catch {
      showToast("Не удалось запустить генерацию");
      setMessages((prev) => prev.slice(0, -2)); // откат оптимистичной пары
      setBusy(false);
    }
  }

  function stop() { void api.stopAssistant(docId); }

  // Переключить важность записи лога (звезда в лог-панели).
  async function toggleImportant(messageId: string) {
    const m = messages.find((x) => x.id === messageId);
    const log = m?.meta?.log;
    if (!log) return;
    try {
      const updated = await api.updateMessageMeta(messageId, { log: { ...log, important: !log.important } });
      setMessages((prev) => prev.map((x) => (x.id === messageId ? { ...x, meta: updated.meta } : x)));
    } catch {
      showToast("Не удалось обновить запись лога");
    }
  }

  return { messages, busy, send, stop, toggleImportant };
}
export type GameChatState = ReturnType<typeof useGameChat>;

// Центральная колонка режима игры: лента чата с ИИ-мастером, чипы акторов, поле ввода.
export function GameChat({
  chat, pcs, npcs, documents, buildSystem, playerView,
  currentText, appliedBlocks, docUpdatedAt, onApply, onCreateEntity, onEditEntity,
}: {
  chat: GameChatState;
  pcs: { id: string; title: string }[];
  npcs: { id: string; title: string }[];
  documents: { title: string; type: string }[];
  buildSystem: () => string;
  playerView: boolean;
  currentText: string;
  appliedBlocks: string[];
  docUpdatedAt?: string;
  onApply: (text: string) => void;
  onCreateEntity: (entity: NewEntity) => void;
  onEditEntity: (edit: EditEntity) => void;
}) {
  const [input, setInput] = useState("");
  const [actor, setActor] = useState<Actor>(MASTER);
  // NPC, добавленные чипами на время сессии (в память — «временные» по спеке).
  const [extraNpcs, setExtraNpcs] = useState<{ id: string; title: string }[]>([]);
  const [npcOpen, setNpcOpen] = useState(false);
  const [npcQuery, setNpcQuery] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.busy]);

  function submit() {
    const text = input.trim();
    if (!text || chat.busy) return;
    setInput("");
    void chat.send(text, actor, buildSystem());
  }

  // Сообщение «устарело», если документ сессии сохранялся после него (как в помощнике).
  const isStale = (m: GameMsg): boolean => {
    if (!docUpdatedAt || !m.createdAt) return false;
    const mt = Date.parse(m.createdAt);
    const dt = Date.parse(docUpdatedAt);
    return Number.isFinite(mt) && Number.isFinite(dt) && mt < dt;
  };

  const q = npcQuery.trim().toLowerCase();
  const npcResults = (q ? npcs.filter((n) => n.title.toLowerCase().includes(q)) : npcs).slice(0, 8);

  return (
    <div className="game-chat">
      <div className="chat game-feed" ref={feedRef}>
        {chat.messages.length === 0 && !chat.busy && (
          <p className="chat-empty">Выберите персонажа и опишите его действие — ИИ-мастер ответит. Чип «Мастер» — для вопросов без привязки к персонажу.</p>
        )}
        {chat.messages.map((m, i) => m.role === "user" ? (
          <div key={m.id ?? `i${i}`} className="msg gmsg-user" data-msg-id={m.id}>
            <div className="msg-role">{m.meta?.actorName ?? "Мастер"}</div>
            <Markdown>{m.content}</Markdown>
          </div>
        ) : (
          <div key={m.id ?? `i${i}`} className="msg gmsg-ai" data-msg-id={m.id}>
            <div className="msg-role">ИИ-мастер</div>
            {m.content ? (
              <AssistantAnswer
                content={extractLogBlock(m.content).rest}
                stale={isStale(m)}
                currentText={currentText}
                appliedBlocks={appliedBlocks}
                documents={documents}
                onApply={onApply}
                onCreateEntity={onCreateEntity}
                onEditEntity={onEditEntity}
                renderIntro={(intro) => {
                  const s = parseGameSections(intro);
                  return (
                    <>
                      {s.intro && <Markdown>{s.intro}</Markdown>}
                      {s.read && (
                        <div className="game-read">
                          <div className="game-block-head"><BookOpen size={14} /> Прочитай игрокам</div>
                          <Markdown>{s.read}</Markdown>
                        </div>
                      )}
                      {s.hidden && !playerView && (
                        <div className="game-hidden">
                          <div className="game-block-head"><Lock size={14} /> Скрытое для мастера</div>
                          <Markdown>{s.hidden}</Markdown>
                        </div>
                      )}
                    </>
                  );
                }}
              />
            ) : (
              <div className="typing" aria-label="ИИ печатает"><span></span><span></span><span></span></div>
            )}
          </div>
        ))}
      </div>

      <div className="game-actors">
        {pcs.map((p) => (
          <button key={p.id} type="button" className={`actor-chip${actor.id === p.id ? " active" : ""}`}
            onClick={() => setActor({ kind: "pc", id: p.id, name: p.title })}>{p.title}</button>
        ))}
        {extraNpcs.map((n) => (
          <button key={n.id} type="button" className={`actor-chip actor-chip-npc${actor.id === n.id ? " active" : ""}`}
            onClick={() => setActor({ kind: "npc", id: n.id, name: n.title })}>{n.title}</button>
        ))}
        <div className="actor-npc">
          <button type="button" className="actor-chip actor-add" onClick={() => setNpcOpen((v) => !v)}><Plus size={13} /> NPC</button>
          {npcOpen && (
            <div className="actor-npc-pop">
              <input autoFocus placeholder="Найти NPC…" value={npcQuery} onChange={(e) => setNpcQuery(e.target.value)} />
              <div className="actor-npc-list">
                {npcResults.map((n) => (
                  <button key={n.id} type="button" onClick={() => {
                    setExtraNpcs((prev) => (prev.some((x) => x.id === n.id) ? prev : [...prev, n]));
                    setActor({ kind: "npc", id: n.id, name: n.title });
                    setNpcOpen(false);
                    setNpcQuery("");
                  }}>{n.title}</button>
                ))}
                {!npcResults.length && <p className="muted">Не найдено</p>}
              </div>
            </div>
          )}
        </div>
        <button type="button" className={`actor-chip actor-master${actor.kind === "master" ? " active" : ""}`}
          onClick={() => setActor(MASTER)}><User size={13} /> Мастер</button>
      </div>

      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="game-chat-input" className="sr-only">Сообщение ИИ-мастеру</label>
        <MentionTextarea
          id="game-chat-input"
          ref={textareaRef}
          rows={2}
          placeholder={actor.kind === "master" ? "Спросите ИИ-мастера… (@ — вставить сущность)" : `Что делает ${actor.name}? (@ — вставить сущность)`}
          value={input}
          onChange={setInput}
          onEnter={submit}
          mentions={documents}
          disabled={chat.busy}
        />
        {chat.busy ? (
          <button type="button" className="chat-send chat-stop" onClick={chat.stop} title="Остановить генерацию — набранный текст останется">
            <Square size={13} strokeWidth={2.2} /> <span>Стоп</span>
          </button>
        ) : (
          <button type="submit" className="chat-send" title="Отправить">
            <Send size={15} strokeWidth={1.9} /> <span>Отправить</span>
          </button>
        )}
      </form>
    </div>
  );
}

// Лог событий (правая колонка): производная от сообщений с meta.log.
export function GameLogPanel({ messages, onJump, onToggleImportant }: {
  messages: GameMsg[];
  onJump: (messageId: string) => void;
  onToggleImportant: (messageId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const entries = messages.filter(
    (m): m is GameMsg & { id: string; meta: { log: { title: string; important: boolean } } } =>
      m.role === "assistant" && !!m.id && !!m.meta?.log,
  );
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <div className="game-log">
      <div className="game-log-head">Лог событий</div>
      <div className="game-log-list" ref={listRef}>
        {entries.length === 0 && <p className="muted game-log-empty">Действия персонажей будут появляться здесь.</p>}
        {entries.map((m) => (
          <div key={m.id} className={`game-log-item${m.meta.log.important ? " important" : ""}`}>
            <button type="button" className="game-log-star" onClick={() => onToggleImportant(m.id)}
              title={m.meta.log.important ? "Снять пометку важного" : "Пометить важным"}>
              <Star size={13} fill={m.meta.log.important ? "currentColor" : "none"} />
            </button>
            <button type="button" className="game-log-title" onClick={() => onJump(m.id)} title="Показать в чате">
              {m.meta.log.title}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Проверка**

Run: `pnpm --filter @master-ai/web typecheck`
Expected: PASS (компонент ещё не подключён — это нормально; vite/TS не ругаются на неиспользуемый файл).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/GameChat.tsx
git commit -m "Игровой чат: useGameChat, лента с секциями «Прочитай игрокам»/«Скрытое», чипы акторов, панель лога"
```

---

### Task 8: Веб — новая компоновка PlaySession + CSS

**Files:**
- Modify: `packages/web/src/pages/PlaySession.tsx` (существенная переработка)
- Modify: `packages/web/src/styles.css:546-656` (блок `.play-*`) и добавление новых стилей

**Interfaces:**
- Consumes: всё из Task 7; `entityBlocksPrompt` из Task 6; `GameLogEntry`/`MessageMeta` типы.
- Produces: новый экран режима игры. Удаляются: вкладка-textarea «Лог сессии», `aiAppendLog`, встроенный `DocumentAssistant`. Появляются: центр — `GameChat`; правая колонка — `GameLogPanel` + вкладки `scenario | docs | combat`.

- [ ] **Step 1: Переработать PlaySession.tsx**

Изменения по блокам (остальной код файла — без изменений):

**Импорты** — удалить `streamComplete`-использование для лога (aiAppendLog удаляется целиком; `streamComplete` остаётся для aiFillCombat), удалить импорт `DocumentAssistant`, `getDocumentType`; добавить:

```ts
import { GameChat, GameLogPanel, useGameChat, type GameMsg } from "./GameChat.js";
import { blockKey, entityBlocksPrompt, parseAssistant, type NewEntity } from "./assistant-blocks.js";
```

**Удалить** состояния и код старого лога: `tab` меняет тип, `log`, `logSaved`, `logRef`, `logAiBusy`, effect автосохранения лога (строки 149-157), функцию `aiAppendLog` (214-245), чтение `fields.sessionLog` в первом effect (строки 122-124 — оставить только `setDoc(d)`).

**Вкладки**: `const [tab, setTab] = useState<"scenario" | "docs" | "combat">("scenario");`

**Игровой чат** (после объявления `patchFields`):

```ts
  // Игровой чат с ИИ-мастером: состояние здесь, чтобы лог-панель строилась из тех же сообщений.
  const chat = useGameChat(documentId!, (content) => {
    openMentionedDocs(content);
    parseAssistant(content).newDocs.forEach((nd) => showProposedDoc(nd));
  });

  // Текстовое представление лога событий — для промпта ИИ-мастера и сбора боя.
  const gameLogText = (msgs: GameMsg[]) =>
    msgs.filter((m) => m.meta?.log)
      .map((m) => `- ${m.meta!.log!.important ? "[важно] " : ""}${m.meta!.log!.title}`)
      .join("\n");

  // Системный промпт ИИ-мастера: план сессии + лог + правила формата ответа.
  function buildGameSystem(): string {
    const d = docRef.current;
    const logLines = gameLogText(chat.messages);
    return (
      `Ты — ИИ-мастер настольной ролевой игры, помогаешь живому мастеру вести сессию «${d?.title ?? ""}» кампании «${campaignName}». Всегда отвечай по-русски.\n\n` +
      `План сессии:\n${d ? pmText(d.contentJson).trim() || "(пусто)" : "(пусто)"}\n\n` +
      (logLines ? `Лог событий этой сессии:\n${logLines}\n\n` : "") +
      `Сообщения вида «Действие (Имя): …» — заявки персонажей игроков или NPC. На такую заявку отвечай СТРОГО в формате:\n` +
      `## Прочитай игрокам\n<живое описание происходящего для чтения игрокам вслух, 2–6 предложений>\n` +
      `## Скрытое для мастера\n<то, что игроки не видят: механика, сложности проверок, скрытые последствия, планы NPC; если скрывать нечего — пропусти секцию целиком>\n` +
      `В САМОМ КОНЦЕ такого ответа добавь служебный блок:\n` +
      "```log\n" +
      `{"title": "<краткий заголовок события, 3–7 слов>", "important": <true только для поворотных событий: смерть, крупная находка, раскрытие тайны, начало и исход боя; иначе false>}\n` +
      "```\n\n" +
      `Остальные сообщения — вопросы мастера тебе: отвечай обычным текстом, без секций и без log-блока.\n\n` +
      entityBlocksPrompt(docs.map((x) => ({ title: x.title, type: x.type })))
    );
  }

  // Переход из лога к сообщению в ленте чата.
  function jumpToMessage(messageId: string) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("msg-flash");
    setTimeout(() => el.classList.remove("msg-flash"), 1600);
  }
```

**openMentionedDocs** — дополнить переключением на вкладку документов при находке:

```ts
  function openMentionedDocs(text: string) {
    for (const span of matchMentions(text, prepared)) {
      if (span.href) openDoc(span.href);
    }
  }
```

(без автопереключения вкладки — документы тихо открываются в стеке, как раньше; клик по ссылке в сценарии переключает вкладку явно, см. ниже.)

**openDoc** — при открытии документа показать вкладку «Документы»:

```ts
  function openDoc(id: string) {
    if (!id) return;
    setTab("docs");
    setView((v) => {
      if (v.idx >= 0 && v.stack[v.idx] === id) return v;
      const stack = v.stack.slice(0, v.idx + 1);
      stack.push(id);
      return { stack, idx: stack.length - 1 };
    });
  }
```

**aiFillCombat** — заменить обе подстановки `${log || "(пусто)"}` на `${gameLogText(chat.messages) || "(пусто)"}` (переменной `log` больше нет). Запрос беседы `api.getDocumentConversation` остаётся как был.

**Акторы** (перед return):

```ts
  const pcs = docs
    .filter((d) => d.type === "pc" && d.status !== "retired" && d.status !== "deceased")
    .map((d) => ({ id: d.id, title: d.title }));
  const npcs = docs.filter((d) => d.type === "npc").map((d) => ({ id: d.id, title: d.title }));
```

**JSX тела** — заменить весь блок `<div className="play-body">…</div>` (строки 335-467) на:

```tsx
      <div className="play-body">
        <div className="play-center">
          <GameChat
            chat={chat}
            pcs={pcs}
            npcs={npcs}
            documents={docs.map((d) => ({ title: d.title, type: d.type }))}
            buildSystem={buildGameSystem}
            playerView={playerView}
            currentText={pmText(doc.contentJson).trim()}
            appliedBlocks={(doc.fields?.appliedDocBlocks as string[] | undefined) ?? []}
            docUpdatedAt={(doc.fields?.contentUpdatedAt as string | undefined) ?? doc.updatedAt}
            onApply={applyToSession}
            onCreateEntity={() => showToast("Создавайте сущности вне режима игры")}
            onEditEntity={() => showToast("Изменяйте документы вне режима игры")}
          />
        </div>

        <aside className="play-side">
          {!playerView && (
            <GameLogPanel messages={chat.messages} onJump={jumpToMessage} onToggleImportant={(id) => void chat.toggleImportant(id)} />
          )}

          <div className="play-panel">
            <div className="play-tabs2">
              <button type="button" className={tab === "scenario" ? "active" : ""} onClick={() => setTab("scenario")}>Сценарий</button>
              <button type="button" className={tab === "docs" ? "active" : ""} onClick={() => setTab("docs")}>Документы</button>
              <button type="button" className={tab === "combat" ? "active" : ""} onClick={() => setTab("combat")}>Бой</button>
            </div>
            {/* Все вкладки смонтированы всегда — переключение прячет, а не размонтирует. */}
            <div
              className="play-content play-scenario"
              style={{ display: tab === "scenario" ? undefined : "none" }}
              ref={contentRef}
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest("a.play-link") as HTMLElement | null;
                if (!a?.dataset.docId) return;
                e.preventDefault();
                // Одноимённые документы: повторный клик открывает следующий по кругу.
                const ids = a.dataset.docIds ? a.dataset.docIds.split(",") : [];
                if (ids.length > 1) openDoc(ids[(ids.indexOf(view.stack[view.idx]) + 1) % ids.length]);
                else openDoc(a.dataset.docId);
              }}
            >
              {sections.length === 0 ? (
                <p className="muted">Сессия пуста — заполните её на странице документа.</p>
              ) : (
                sections.map((sec, i) => {
                  const gm = isGmOnly(sec.heading);
                  if (playerView && gm) return null;
                  return (
                    <div key={i} className={`play-section${gm ? " gm" : ""}`}>
                      {sec.heading && (
                        <div className="play-section-bar">
                          <button type="button" className="play-eye" onClick={() => toggleSectionVis(sec.heading!)} title={gm ? "Виден игрокам (снять пометку)" : "Пометить «только мастер»"}>
                            {gm ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          {gm && <span className="play-section-lock">только мастер</span>}
                        </div>
                      )}
                      <div className="md" dangerouslySetInnerHTML={{ __html: contentToHtml(sec.doc) }} />
                    </div>
                  );
                })
              )}
            </div>

            <div className="play-viewer" style={{ display: tab === "docs" ? undefined : "none" }}>
              {/* … блок просмотрщика целиком без изменений: play-viewer-nav, play-pins, play-viewer-body
                   (перенести дословно из старого JSX, строки 374-414) … */}
            </div>

            <div className="play-combat-wrap" style={{ display: tab === "combat" ? undefined : "none" }}>
              <CombatTracker
                combat={(doc.fields?.combat as CombatState) ?? null}
                onChange={(c) => void patchFields({ combat: c })}
                candidates={docs.filter((d) => d.type === "pc" || d.type === "npc").map((d) => ({ id: d.id, title: d.title, type: d.type }))}
                onAiFill={aiFillCombat}
                aiBusy={combatAiBusy}
              />
            </div>
          </div>
        </aside>
      </div>
```

(Блок просмотрщика — существующая разметка `play-viewer-nav`/`play-pins`/`play-viewer-body` переносится дословно, меняется только обёртка со `style={{ display: … }}`.)

Убрать неиспользуемые после правки импорты (`getDocumentType`, `DocumentAssistant`) — typecheck подскажет точный список.

- [ ] **Step 2: CSS**

В `packages/web/src/styles.css`:

**Заменить** строку 554:

```css
.play-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 32%); }
```

**Заменить** правило `.play-content` (555) — сценарий теперь во вкладке правой колонки:

```css
.play-center { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.play-content { min-height: 0; overflow-y: auto; padding: 16px 18px; line-height: 1.65; font-size: 0.95rem; flex: 1 1 auto; }
```

**Заменить** `.play-viewer` (557): убрать `border-bottom` и flex-долю:

```css
.play-viewer { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
```

**Удалить** правила старого лога и ассистента: `.play-log-wrap`, `.play-log`, `.play-log-bar`, `.play-log-ai`, `.play-log-ai:disabled`, `.play-log:focus`, `.play-draft`, `.play-draft.saved`, `.play-assistant`, `.play-assistant .doc-assistant` (строки 637-646) и упоминание `.play-log` в медиа-блоке 860px (строка 650).

**Добавить** после блока `.play-*` (после строки ~636):

```css
/* ---------- Игровой чат режима игры ---------- */
.game-chat { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.game-feed { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 22px 30px; display: flex; flex-direction: column; gap: 14px; }
.gmsg-user .msg-role { color: var(--accent-hover); }
.game-block-head { display: flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 6px; }
.game-read { margin: 10px 0; padding: 14px 16px; border: 1px solid rgba(59,130,246,0.35); border-left: 3px solid var(--accent); border-radius: var(--radius); background: var(--accent-soft); font-size: 1.02rem; line-height: 1.65; }
.game-read .game-block-head { color: var(--accent-hover); }
.game-hidden { margin: 10px 0; padding: 12px 16px; border: 1px solid rgba(251,191,36,0.3); border-left: 3px solid #fbbf24; border-radius: var(--radius); color: var(--muted); background: rgba(251,191,36,0.07); }
.game-hidden .game-block-head { color: #fbbf24; }
.msg-flash { animation: msg-flash 1.6s ease; }
@keyframes msg-flash { 0%, 60% { box-shadow: 0 0 0 2px var(--accent); } 100% { box-shadow: none; } }
.game-actors { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px 0; }
.actor-chip { padding: 4px 12px; font-size: 0.8rem; font-weight: 600; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; color: var(--text); }
.actor-chip:hover { filter: none; border-color: var(--accent); }
.actor-chip.active { color: var(--accent-hover); border-color: var(--accent); background: var(--accent-soft); }
.actor-chip-npc { border-style: dashed; }
.actor-add, .actor-master { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
.actor-npc { position: relative; }
.actor-npc-pop { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 10; width: 230px; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 8px 24px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 6px; }
.actor-npc-pop input { width: 100%; }
.actor-npc-list { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; }
.actor-npc-list button { text-align: left; padding: 6px 8px; background: none; border: none; border-radius: 7px; color: var(--text); }
.actor-npc-list button:hover { filter: none; background: var(--surface-2); }
.game-chat .chat-form { padding: 10px 14px 14px; }
/* Лог событий (правая колонка) */
.game-log { flex: none; height: 42%; min-height: 140px; display: flex; flex-direction: column; border-bottom: 1px solid var(--border); }
.game-log-head { flex: none; padding: 12px 18px 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
.game-log-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.game-log-empty { padding: 0 8px; font-size: 0.85rem; }
.game-log-item { display: flex; align-items: flex-start; gap: 4px; border-radius: 8px; }
.game-log-item:hover { background: var(--surface-2); }
.game-log-star { flex: none; padding: 6px 4px 6px 8px; background: none; border: none; color: var(--muted); opacity: 0.5; }
.game-log-item:hover .game-log-star { opacity: 1; }
.game-log-star:hover { filter: none; color: #fbbf24; }
.game-log-item.important .game-log-star { color: #fbbf24; opacity: 1; }
.game-log-title { flex: 1 1 auto; min-width: 0; text-align: left; padding: 6px 8px 6px 0; background: none; border: none; color: var(--text); font-size: 0.85rem; line-height: 1.35; }
.game-log-title:hover { filter: none; color: var(--text-strong); }
.game-log-item.important .game-log-title { color: var(--text-strong); font-weight: 600; }
```

**Обновить** медиа-блок 860px (строки 647-651):

```css
@media (max-width: 860px) {
  .play-body { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1.2fr) minmax(0, 1fr); }
  .play-side { border-left: none; border-top: 1px solid var(--border); }
  .game-log { height: 130px; min-height: 130px; }
}
```

- [ ] **Step 3: Проверка**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/PlaySession.tsx packages/web/src/styles.css
git commit -m "Режим игры: игровой чат с ИИ-мастером в центре, лог событий и вкладки Сценарий/Документы/Бой справа"
```

---

### Task 9: Сквозная проверка в работающем приложении

**Files:** нет изменений кода (кроме найденных багов).

- [ ] **Step 1: Полный прогон проверок**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS везде.

- [ ] **Step 2: Ручная проверка через Playwright**

Запустить дев-сервер: `pnpm dev` (фоном). Открыть браузером (Playwright MCP) `http://localhost:5173` (порт см. вывод vite) и пройти чек-лист:

1. Открыть кампанию → «Запустить сессию» (создать сессию, если нет; создать 2 документа типа pc со статусом active и 1 npc заранее через Базу знаний).
2. Центр — чат; над полем ввода чипы персонажей, «+ NPC», «Мастер» (выбран по умолчанию).
3. Клик по чипу персонажа → placeholder меняется на «Что делает <Имя>?». Отправить действие.
4. Ответ ИИ рендерится карточкой: блок «Прочитай игрокам» (акцентный) и, если ИИ вернул, «Скрытое для мастера» (жёлтый, приглушённый); log-блок в тексте НЕ виден.
5. В правой колонке появилась запись лога с коротким заголовком; клик по записи прокручивает чат к сообщению и подсвечивает его.
6. Клик по звезде записи — становится важной (жёлтая, жирная); повторный клик снимает.
7. Чип «Мастер» → вопрос («какая сложность взлома?») → обычный ответ без секций, записи в логе НЕ появилось.
8. «+ NPC» → поиск → выбор: NPC-чип добавлен (пунктирная рамка), действие от NPC создаёт запись в логе.
9. Вкладки справа: «Сценарий» показывает текст сессии с глазиками; клик по упоминанию в сценарии открывает документ и переключает на «Документы»; пины работают; «Бой» — трекер, «Из чата» подтягивает участников.
10. Тумблер «Показ игрокам»: скрываются блоки «Скрытое для мастера» в чате, панель лога и gm-секции сценария.
11. Перезагрузить страницу — история чата и лог на месте (persist). Отправить действие и сразу перейти на другую страницу, вернуться — генерация продолжилась (фоновая задача).
12. Помощник документа на обычной странице документа работает как раньше (регрессия после Task 6): предложение правки с diff, применение.
13. «Следующая сессия» — создаётся с «Что было в прошлый раз», где упомянуты события из игрового лога.

Expected: все пункты проходят; скриншоты ключевых состояний сохранить в корень проекта не нужно — только при находке багов.

- [ ] **Step 3: Финальный коммит (если были фиксы)**

```bash
git add -A && git commit -m "Правки по результатам сквозной проверки режима игры"
```

---

## Соответствие спеке (самопроверка)

- Чат в центре, карточки с двумя блоками — Task 7/8. ✔
- Чипы: pc + «+ NPC» с поиском + «Мастер» по умолчанию — Task 7. ✔
- ИИ решает сам (действие → секции + log; вопрос мастера → обычный текст) — промпт в Task 8, сервер в Task 3. ✔
- Каждое действие = запись лога (fallback-заголовок при отсутствии log-блока) — Task 3. ✔
- Лог — производная от `messages.meta`, клик → скролл + подсветка, звезда важности (PATCH) — Tasks 2/3/7/8. ✔
- Сценарий/Документы/Бой сохранены в правой колонке, display:none — Task 8. ✔
- «Показ игрокам» скрывает 🔒-блоки и лог — Tasks 7/8. ✔
- Возможности ассистента (doc/new-doc/edit-doc, упоминания → просмотрщик) — Tasks 6/7. ✔
- Сводка «Следующей сессии» из игрового лога + чата, fallback на старый sessionLog — Task 4. ✔
- Фоновая генерация переживает навигацию — переиспользован AssistantJobService (Tasks 3/7). ✔
