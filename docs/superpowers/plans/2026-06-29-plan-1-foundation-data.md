# master-ai — План 1: Фундамент и слой данных

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рабочий локальный бэкенд, который персистит кампании и типизированные документы в SQLite и отдаёт их через Fastify REST API.

**Architecture:** Монорепо на pnpm workspaces. Пакет `shared` хранит zod-схемы и выведенные из них типы (единый контракт фронта и бэка). Пакет `server` — Fastify + Drizzle ORM поверх локального SQLite (better-sqlite3). Типы документов заданы как данные (реестр), а не как код.

**Tech Stack:** Node 20+, pnpm, TypeScript (ESM), Fastify 5, Drizzle ORM + better-sqlite3, zod, Vitest.

## Global Constraints

- Node.js **20+**, менеджер пакетов — **pnpm** (workspaces).
- TypeScript, модули — **ESM** (`"type": "module"` во всех package.json, `"module": "NodeNext"`).
- Все ID — строки, генерируются через `crypto.randomUUID()`.
- Все временные метки — ISO-строки (`new Date().toISOString()`).
- Тесты — **Vitest**. Каждый таск завершается зелёным прогоном тестов и коммитом.
- Коммиты — только имя автора, без Co-Authored-By.
- Рабочая директория проекта: `Docs/НРИ/master-ai/` (все пути ниже относительны к ней).

---

### Task 1: Монорепо и пакет shared с базовыми типами

**Files:**
- Create: `package.json` (корневой)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/campaign.ts`
- Test: `packages/shared/src/campaign.test.ts`

**Interfaces:**
- Consumes: ничего (первый таск).
- Produces:
  - `CampaignSchema` (zod) и тип `Campaign = { id: string; name: string; system: string | null; description: string | null; createdAt: string }`.
  - `NewCampaignSchema` (zod) и тип `NewCampaign = { name: string; system?: string | null; description?: string | null }`.

- [ ] **Step 1: Создать корневые файлы монорепо**

`package.json`:
```json
{
  "name": "master-ai",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.sqlite
*.sqlite-journal
.DS_Store
```

- [ ] **Step 2: Создать пакет shared**

`packages/shared/package.json`:
```json
{
  "name": "@master-ai/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 3: Написать падающий тест на схему Campaign**

`packages/shared/src/campaign.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CampaignSchema, NewCampaignSchema } from "./campaign.js";

describe("CampaignSchema", () => {
  it("принимает валидную кампанию", () => {
    const value = {
      id: "abc",
      name: "Город Солнца",
      system: "Hunter: The Vigil",
      description: null,
      createdAt: "2026-06-29T00:00:00.000Z",
    };
    expect(CampaignSchema.parse(value)).toEqual(value);
  });

  it("NewCampaignSchema требует только name", () => {
    expect(NewCampaignSchema.parse({ name: "X" })).toEqual({ name: "X" });
  });

  it("NewCampaignSchema отвергает пустой объект", () => {
    expect(() => NewCampaignSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 4: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/shared test`
Expected: FAIL — модуль `./campaign.js` не найден.

- [ ] **Step 5: Реализовать схемы**

`packages/shared/src/campaign.ts`:
```ts
import { z } from "zod";

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  system: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const NewCampaignSchema = z.object({
  name: z.string().min(1),
  system: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type NewCampaign = z.infer<typeof NewCampaignSchema>;
```

`packages/shared/src/index.ts`:
```ts
export * from "./campaign.js";
```

- [ ] **Step 6: Установить зависимости и запустить тест**

Run: `pnpm install && pnpm --filter @master-ai/shared test`
Expected: PASS (3 теста).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/shared
git commit -m "master-ai: монорепо + пакет shared со схемой Campaign"
```

---

### Task 2: Схема Document и реестр типов документов в shared

**Files:**
- Create: `packages/shared/src/document.ts`
- Create: `packages/shared/src/document-types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/document.test.ts`
- Test: `packages/shared/src/document-types.test.ts`

**Interfaces:**
- Consumes: ничего нового.
- Produces:
  - `DocumentSchema` / `Document = { id, campaignId, type, title, status: string | null, contentJson: unknown, fields: Record<string, unknown>, createdAt, updatedAt }`.
  - `NewDocumentSchema` / `NewDocument = { campaignId, type, title, status?, contentJson?, fields? }`.
  - `DOCUMENT_TYPES: DocumentTypeDef[]` и `getDocumentType(key: string): DocumentTypeDef | undefined`.
  - `DocumentTypeDef = { key: string; label: string; icon: string; statuses: string[] }`.

- [ ] **Step 1: Написать падающий тест на DocumentSchema**

`packages/shared/src/document.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DocumentSchema, NewDocumentSchema } from "./document.js";

describe("DocumentSchema", () => {
  it("принимает валидный документ", () => {
    const value = {
      id: "d1",
      campaignId: "c1",
      type: "npc",
      title: "Барон фон Кройц",
      status: "alive",
      contentJson: { type: "doc", content: [] },
      fields: { faction: "Совет" },
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    };
    expect(DocumentSchema.parse(value)).toEqual(value);
  });

  it("NewDocumentSchema требует campaignId, type, title", () => {
    const parsed = NewDocumentSchema.parse({
      campaignId: "c1",
      type: "npc",
      title: "X",
    });
    expect(parsed.title).toBe("X");
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/shared test document`
Expected: FAIL — `./document.js` не найден.

- [ ] **Step 3: Реализовать DocumentSchema**

`packages/shared/src/document.ts`:
```ts
import { z } from "zod";

export const DocumentSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  contentJson: z.unknown(),
  fields: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const NewDocumentSchema = z.object({
  campaignId: z.string(),
  type: z.string(),
  title: z.string().min(1),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
});
export type NewDocument = z.infer<typeof NewDocumentSchema>;
```

- [ ] **Step 4: Написать падающий тест на реестр типов**

`packages/shared/src/document-types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DOCUMENT_TYPES, getDocumentType } from "./document-types.js";

describe("DOCUMENT_TYPES", () => {
  it("содержит базовые типы", () => {
    const keys = DOCUMENT_TYPES.map((t) => t.key);
    expect(keys).toContain("npc");
    expect(keys).toContain("location");
    expect(keys).toContain("secret");
    expect(keys).toContain("note");
  });

  it("getDocumentType возвращает определение по ключу", () => {
    expect(getDocumentType("npc")?.label).toBeTruthy();
    expect(getDocumentType("missing")).toBeUndefined();
  });
});
```

- [ ] **Step 5: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/shared test document-types`
Expected: FAIL — `./document-types.js` не найден.

- [ ] **Step 6: Реализовать реестр типов**

`packages/shared/src/document-types.ts`:
```ts
export interface DocumentTypeDef {
  key: string;
  label: string;
  icon: string;
  statuses: string[];
}

export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  { key: "npc", label: "NPC", icon: "user", statuses: ["alive", "dead", "unknown"] },
  { key: "location", label: "Локация", icon: "map-pin", statuses: [] },
  { key: "faction", label: "Фракция", icon: "users", statuses: [] },
  { key: "secret", label: "Секрет", icon: "lock", statuses: ["hidden", "revealed"] },
  { key: "scene", label: "Сцена", icon: "clapperboard", statuses: ["planned", "used"] },
  { key: "session", label: "Сессия", icon: "calendar", statuses: ["planned", "played"] },
  { key: "item", label: "Предмет", icon: "package", statuses: [] },
  { key: "lore", label: "Лор/Референс", icon: "book", statuses: [] },
  { key: "note", label: "Заметка", icon: "file", statuses: [] },
];

export function getDocumentType(key: string): DocumentTypeDef | undefined {
  return DOCUMENT_TYPES.find((t) => t.key === key);
}
```

- [ ] **Step 7: Обновить index.ts**

`packages/shared/src/index.ts`:
```ts
export * from "./campaign.js";
export * from "./document.js";
export * from "./document-types.js";
```

- [ ] **Step 8: Запустить все тесты shared**

Run: `pnpm --filter @master-ai/shared test`
Expected: PASS (все тесты).

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "master-ai: схема Document и реестр типов документов"
```

---

### Task 3: Пакет server, Drizzle-схема и подключение SQLite

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/client.ts`
- Test: `packages/server/src/db/client.test.ts`

**Interfaces:**
- Consumes: `@master-ai/shared`.
- Produces:
  - `campaigns` и `documents` — Drizzle-таблицы (экспорт из `schema.ts`).
  - `createDb(path: string): { db: BetterSQLite3Database; sqlite: Database }` — создаёт подключение и применяет схему (таблицы) к новой БД. Путь `":memory:"` — для тестов.

- [ ] **Step 1: Создать пакет server**

`packages/server/package.json`:
```json
{
  "name": "@master-ai/server",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "node --experimental-strip-types --watch src/main.ts"
  },
  "dependencies": {
    "@master-ai/shared": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.33.0",
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "drizzle-kit": "^0.24.0"
  }
}
```

`packages/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Описать Drizzle-схему**

`packages/server/src/db/schema.ts`:
```ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  system: text("system"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  status: text("status"),
  // ProseMirror-документ и типозависимые поля храним как JSON-строки
  contentJson: text("content_json").notNull().default("null"),
  fields: text("fields").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 3: Написать падающий тест на createDb**

`packages/server/src/db/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "./client.js";
import { campaigns } from "./schema.js";

describe("createDb", () => {
  it("создаёт таблицы в in-memory БД", () => {
    const { db } = createDb(":memory:");
    // вставка и чтение проходят — значит таблица существует
    db.insert(campaigns)
      .values({ id: "c1", name: "Test", system: null, description: null, createdAt: "2026-06-29T00:00:00.000Z" })
      .run();
    const rows = db.select().from(campaigns).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Test");
  });
});
```

- [ ] **Step 4: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test`
Expected: FAIL — `./client.js` не найден.

- [ ] **Step 5: Реализовать createDb**

`packages/server/src/db/client.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  content_json TEXT NOT NULL DEFAULT 'null',
  fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function createDb(path: string): {
  db: BetterSQLite3Database;
  sqlite: Database.Database;
} {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(CREATE_TABLES);
  const db = drizzle(sqlite);
  return { db, sqlite };
}
```

> Примечание: на этом этапе схему создаём прямым `CREATE TABLE IF NOT EXISTS` (просто и достаточно для локального однопользовательского приложения). Полноценные миграции через drizzle-kit добавим, когда схема начнёт меняться между релизами.

- [ ] **Step 6: Запустить тест — убедиться, что проходит**

Run: `pnpm install && pnpm --filter @master-ai/server test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server
git commit -m "master-ai: пакет server, Drizzle-схема и подключение SQLite"
```

---

### Task 4: Сервис кампаний (CRUD поверх БД)

**Files:**
- Create: `packages/server/src/services/campaigns.ts`
- Test: `packages/server/src/services/campaigns.test.ts`

**Interfaces:**
- Consumes: `createDb` (Task 3), `campaigns` (Task 3), `NewCampaign`, `Campaign` (Task 1).
- Produces класс `CampaignService` с методами:
  - `create(input: NewCampaign): Campaign`
  - `list(): Campaign[]`
  - `get(id: string): Campaign | undefined`

- [ ] **Step 1: Написать падающий тест**

`packages/server/src/services/campaigns.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "../db/client.js";
import { CampaignService } from "./campaigns.js";

function makeService() {
  const { db } = createDb(":memory:");
  return new CampaignService(db);
}

describe("CampaignService", () => {
  it("create возвращает кампанию с id и createdAt", () => {
    const svc = makeService();
    const c = svc.create({ name: "Город Солнца" });
    expect(c.id).toMatch(/.+/);
    expect(c.name).toBe("Город Солнца");
    expect(c.system).toBeNull();
    expect(c.createdAt).toMatch(/^\d{4}-/);
  });

  it("list возвращает созданные кампании", () => {
    const svc = makeService();
    svc.create({ name: "A" });
    svc.create({ name: "B" });
    expect(svc.list()).toHaveLength(2);
  });

  it("get возвращает кампанию по id или undefined", () => {
    const svc = makeService();
    const c = svc.create({ name: "A" });
    expect(svc.get(c.id)?.name).toBe("A");
    expect(svc.get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test campaigns`
Expected: FAIL — `./campaigns.js` не найден.

- [ ] **Step 3: Реализовать сервис**

`packages/server/src/services/campaigns.ts`:
```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Campaign, NewCampaign } from "@master-ai/shared";
import { campaigns } from "../db/schema.js";

export class CampaignService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewCampaign): Campaign {
    const row: Campaign = {
      id: randomUUID(),
      name: input.name,
      system: input.system ?? null,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(campaigns).values(row).run();
    return row;
  }

  list(): Campaign[] {
    return this.db.select().from(campaigns).all();
  }

  get(id: string): Campaign | undefined {
    return this.db.select().from(campaigns).where(eq(campaigns.id, id)).get();
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm --filter @master-ai/server test campaigns`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services
git commit -m "master-ai: сервис кампаний (CRUD)"
```

---

### Task 5: Сервис документов (CRUD с JSON-сериализацией)

**Files:**
- Create: `packages/server/src/services/documents.ts`
- Test: `packages/server/src/services/documents.test.ts`

**Interfaces:**
- Consumes: `createDb`, `documents` (Task 3), `NewDocument`, `Document` (Task 2).
- Produces класс `DocumentService` с методами:
  - `create(input: NewDocument): Document`
  - `listByCampaign(campaignId: string): Document[]`
  - `get(id: string): Document | undefined`
  - `update(id: string, patch: Partial<Pick<Document, "title" | "status" | "contentJson" | "fields">>): Document | undefined`
- Внутри сервиса `contentJson` и `fields` сериализуются в строки при записи и парсятся при чтении; наружу методы отдают распарсенные значения.

- [ ] **Step 1: Написать падающий тест**

`packages/server/src/services/documents.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";

function makeService() {
  const { db } = createDb(":memory:");
  return new DocumentService(db);
}

describe("DocumentService", () => {
  it("create сохраняет и возвращает документ с распарсенными полями", () => {
    const svc = makeService();
    const doc = svc.create({
      campaignId: "c1",
      type: "npc",
      title: "Барон",
      contentJson: { type: "doc", content: [] },
      fields: { faction: "Совет" },
    });
    expect(doc.id).toMatch(/.+/);
    expect(doc.contentJson).toEqual({ type: "doc", content: [] });
    expect(doc.fields).toEqual({ faction: "Совет" });
    expect(doc.status).toBeNull();
  });

  it("listByCampaign фильтрует по кампании", () => {
    const svc = makeService();
    svc.create({ campaignId: "c1", type: "npc", title: "A" });
    svc.create({ campaignId: "c2", type: "npc", title: "B" });
    const list = svc.listByCampaign("c1");
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("A");
  });

  it("update меняет поля и обновляет updatedAt", () => {
    const svc = makeService();
    const doc = svc.create({ campaignId: "c1", type: "npc", title: "A" });
    const updated = svc.update(doc.id, { title: "B", fields: { x: 1 } });
    expect(updated?.title).toBe("B");
    expect(updated?.fields).toEqual({ x: 1 });
  });

  it("get возвращает undefined для несуществующего id", () => {
    const svc = makeService();
    expect(svc.get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test documents`
Expected: FAIL — `./documents.js` не найден.

- [ ] **Step 3: Реализовать сервис**

`packages/server/src/services/documents.ts`:
```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Document, NewDocument } from "@master-ai/shared";
import { documents } from "../db/schema.js";

interface DocumentRow {
  id: string;
  campaignId: string;
  type: string;
  title: string;
  status: string | null;
  contentJson: string;
  fields: string;
  createdAt: string;
  updatedAt: string;
}

function toDocument(row: DocumentRow): Document {
  return {
    ...row,
    contentJson: JSON.parse(row.contentJson),
    fields: JSON.parse(row.fields),
  };
}

export class DocumentService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewDocument): Document {
    const now = new Date().toISOString();
    const row: DocumentRow = {
      id: randomUUID(),
      campaignId: input.campaignId,
      type: input.type,
      title: input.title,
      status: input.status ?? null,
      contentJson: JSON.stringify(input.contentJson ?? null),
      fields: JSON.stringify(input.fields ?? {}),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(documents).values(row).run();
    return toDocument(row);
  }

  listByCampaign(campaignId: string): Document[] {
    const rows = this.db
      .select()
      .from(documents)
      .where(eq(documents.campaignId, campaignId))
      .all() as DocumentRow[];
    return rows.map(toDocument);
  }

  get(id: string): Document | undefined {
    const row = this.db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .get() as DocumentRow | undefined;
    return row ? toDocument(row) : undefined;
  }

  update(
    id: string,
    patch: Partial<Pick<Document, "title" | "status" | "contentJson" | "fields">>,
  ): Document | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updates: Partial<DocumentRow> = { updatedAt: new Date().toISOString() };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.contentJson !== undefined) updates.contentJson = JSON.stringify(patch.contentJson);
    if (patch.fields !== undefined) updates.fields = JSON.stringify(patch.fields);
    this.db.update(documents).set(updates).where(eq(documents.id, id)).run();
    return this.get(id);
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `pnpm --filter @master-ai/server test documents`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/documents.ts packages/server/src/services/documents.test.ts
git commit -m "master-ai: сервис документов (CRUD с JSON-сериализацией)"
```

---

### Task 6: Fastify-приложение и REST-роуты

**Files:**
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/main.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**
- Consumes: `createDb` (Task 3), `CampaignService` (Task 4), `DocumentService` (Task 5), `NewCampaignSchema`, `NewDocumentSchema` (Task 1/2).
- Produces:
  - `buildApp(deps: { db: BetterSQLite3Database }): FastifyInstance` — собирает приложение с роутами.
  - `main.ts` — точка входа: создаёт БД-файл `./data/master-ai.sqlite` и слушает порт 5174.
- Маршруты:
  - `GET /api/campaigns` → `Campaign[]`
  - `POST /api/campaigns` (body `NewCampaign`) → `Campaign`
  - `GET /api/campaigns/:id` → `Campaign` | 404
  - `GET /api/campaigns/:id/documents` → `Document[]`
  - `POST /api/documents` (body `NewDocument`) → `Document`
  - `GET /api/documents/:id` → `Document` | 404
  - `PATCH /api/documents/:id` (body — частичный патч) → `Document` | 404
  - `GET /api/document-types` → `DocumentTypeDef[]`

- [ ] **Step 1: Написать падающий тест на приложение**

`packages/server/src/app.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";

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
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test app`
Expected: FAIL — `./app.js` не найден.

- [ ] **Step 3: Реализовать buildApp**

`packages/server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  NewCampaignSchema,
  NewDocumentSchema,
  DOCUMENT_TYPES,
} from "@master-ai/shared";
import { z } from "zod";
import { CampaignService } from "./services/campaigns.js";
import { DocumentService } from "./services/documents.js";

const DocumentPatchSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
});

export function buildApp(deps: { db: BetterSQLite3Database }): FastifyInstance {
  const app = Fastify();
  app.register(cors, { origin: true });

  const campaignsSvc = new CampaignService(deps.db);
  const documentsSvc = new DocumentService(deps.db);

  app.get("/api/document-types", () => DOCUMENT_TYPES);

  app.get("/api/campaigns", () => campaignsSvc.list());

  app.post("/api/campaigns", (req, reply) => {
    const parsed = NewCampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(campaignsSvc.create(parsed.data));
  });

  app.get("/api/campaigns/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const campaign = campaignsSvc.get(id);
    if (!campaign) return reply.code(404).send({ error: "not found" });
    return campaign;
  });

  app.get("/api/campaigns/:id/documents", (req) => {
    const { id } = req.params as { id: string };
    return documentsSvc.listByCampaign(id);
  });

  app.post("/api/documents", (req, reply) => {
    const parsed = NewDocumentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(documentsSvc.create(parsed.data));
  });

  app.get("/api/documents/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    return doc;
  });

  app.patch("/api/documents/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = DocumentPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updated = documentsSvc.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  return app;
}
```

- [ ] **Step 4: Создать точку входа main.ts**

`packages/server/src/main.ts`:
```ts
import { mkdirSync } from "node:fs";
import { createDb } from "./db/client.js";
import { buildApp } from "./app.js";

mkdirSync("./data", { recursive: true });
const { db } = createDb("./data/master-ai.sqlite");
const app = buildApp({ db });

const port = 5174;
app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`master-ai server on http://127.0.0.1:${port}`);
});
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `pnpm --filter @master-ai/server test app`
Expected: PASS (5 тестов).

- [ ] **Step 6: Прогнать все тесты монорепо**

Run: `pnpm -r test`
Expected: PASS во всех пакетах.

- [ ] **Step 7: Ручная проверка запуска сервера**

Run: `pnpm --filter @master-ai/server dev`
Expected: в консоли `master-ai server on http://127.0.0.1:5174`. Затем в другом терминале:
`curl http://127.0.0.1:5174/api/document-types` — возвращает JSON-массив типов. Остановить сервер.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/main.ts packages/server/src/app.test.ts
git commit -m "master-ai: Fastify-приложение и REST-роуты кампаний/документов"
```

---

## Self-Review

**Покрытие спека (для Плана 1 — слой данных и API):**
- Модель данных Campaign/Document → Tasks 1, 2, 3, 4, 5. ✅
- Реестр типов документов как данные → Task 2. ✅
- SQLite через Drizzle → Task 3. ✅
- REST API для кампаний и документов → Task 6. ✅
- FTS5-поиск, линковка (Link), Proposal/Conversation, LLM-провайдер, веб-UI, inline-AI — **вне Плана 1**, покрываются Планами 2–5 (см. roadmap в `2026-06-29-master-ai-design.md`). ✅ (осознанно отложено)

**Заглушки:** не найдено — каждый шаг содержит полный код или конкретную команду.

**Согласованность типов:** `Campaign`, `Document`, `NewCampaign`, `NewDocument` определены в Tasks 1–2 и используются с теми же сигнатурами в Tasks 4–6. Имена методов сервисов (`create`, `list`, `get`, `listByCampaign`, `update`) совпадают между определением и вызовами в роутах. ✅
