# Plan 6 — Connected Campaign (линковка + полнотекстовый поиск) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Документы кампании связываются ссылками (с обратными ссылками) и находятся через полнотекстовый поиск по заголовку и тексту контента.

**Architecture:** Реализует фичу D из дизайна. Бэк: таблица `links` (Drizzle) + виртуальная таблица `documents_fts` (SQLite FTS5, создаётся вручную в миграции — drizzle-kit её не генерирует). `DocumentService` поддерживает индекс FTS при create/update; `SearchService` ищет и переиндексирует; `LinkService` создаёт/удаляет/перечисляет связи (исходящие + обратные). Фронт: глобальный поиск на странице кампании и панель связей в редакторе документа.

**Tech Stack:** TypeScript ESM (NodeNext), Drizzle ORM + better-sqlite3 (FTS5), Fastify 5, Vite+React 18, Vitest (+ @testing-library/react в web).

## Global Constraints

- TypeScript ESM, `"module": "NodeNext"` — все относительные импорты обязаны иметь расширение `.js` (в т.ч. для `.tsx`). Общие типы — из `@master-ai/shared`.
- Схема БД — единый источник: Drizzle-таблицы в `schema.ts` + миграции drizzle-kit, применяемые `migrate()` в `createDb`. FTS5-виртуальная таблица создаётся **вручную дописанным** SQL в той же миграции (FTS5 не выражается в schema.ts; в snapshot её нет — это нормально, drizzle сравнивает schema.ts со snapshot, а не с живой БД).
- Сырой SQL из сервиса выполняется через `db.run(sql\`...\`)` с импортом `sql` из `drizzle-orm`; пользовательские значения — только через плейсхолдеры (`${value}`), никогда строковой конкатенацией.
- UTF-8 / кириллица должны работать сквозным образом (русский контент). Токенайзер FTS — `unicode61 remove_diacritics 2`.
- Тесты: Vitest. Сервер — in-memory SQLite (`:memory:`) через `createDb`. Web — @testing-library/react (jsdom), `import { userEvent }` именованным импортом; страницы, использующие `useToast`, оборачиваются в `<ToastProvider>` в тестах. Ошибки API → тост, никогда не глотать молча.
- Коммиты: только имя автора. НИКОГДА не добавлять `Co-Authored-By`/AI/Claude трейлер.

---

### Task 1: Контракты Link и Search в `@master-ai/shared`

**Files:**
- Create: `packages/shared/src/links.ts`
- Create: `packages/shared/src/search.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/links.test.ts`

**Interfaces:**
- Produces: `LinkSchema`/`Link`, `NewLinkSchema`/`NewLink`, `LinkedDocumentSchema`/`LinkedDocument`, `DocumentLinksSchema`/`DocumentLinks`, `SearchHitSchema`/`SearchHit`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/links.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NewLinkSchema, DocumentLinksSchema } from "./index.js";

describe("link contracts", () => {
  it("NewLinkSchema принимает корректную связь", () => {
    const r = NewLinkSchema.safeParse({ campaignId: "c1", fromDocId: "a", toDocId: "b", kind: "появляется в" });
    expect(r.success).toBe(true);
  });

  it("NewLinkSchema требует непустой kind", () => {
    const r = NewLinkSchema.safeParse({ campaignId: "c1", fromDocId: "a", toDocId: "b", kind: "" });
    expect(r.success).toBe(false);
  });

  it("DocumentLinksSchema валидирует группы outgoing/incoming", () => {
    const r = DocumentLinksSchema.safeParse({
      outgoing: [{ linkId: "l1", kind: "связан", document: { id: "b", type: "npc", title: "Барон" } }],
      incoming: [],
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @master-ai/shared test`
Expected: FAIL — модуль `./links.js` / экспорты не существуют.

- [ ] **Step 3: Write the implementations**

`packages/shared/src/links.ts`:
```ts
import { z } from "zod";

export const LinkSchema = z.object({
  id: z.string(),
  campaignId: z.string(),
  fromDocId: z.string(),
  toDocId: z.string(),
  kind: z.string(),
});
export type Link = z.infer<typeof LinkSchema>;

export const NewLinkSchema = z.object({
  campaignId: z.string(),
  fromDocId: z.string(),
  toDocId: z.string(),
  kind: z.string().min(1),
});
export type NewLink = z.infer<typeof NewLinkSchema>;

// Связь в виде, удобном для UI: id связи, её вид и документ на другом конце.
export const LinkedDocumentSchema = z.object({
  linkId: z.string(),
  kind: z.string(),
  document: z.object({ id: z.string(), type: z.string(), title: z.string() }),
});
export type LinkedDocument = z.infer<typeof LinkedDocumentSchema>;

export const DocumentLinksSchema = z.object({
  outgoing: z.array(LinkedDocumentSchema),
  incoming: z.array(LinkedDocumentSchema),
});
export type DocumentLinks = z.infer<typeof DocumentLinksSchema>;
```

`packages/shared/src/search.ts`:
```ts
import { z } from "zod";

export const SearchHitSchema = z.object({
  docId: z.string(),
  type: z.string(),
  title: z.string(),
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;
```

- [ ] **Step 4: Add re-exports**

In `packages/shared/src/index.ts` add after the existing lines:
```ts
export * from "./links.js";
export * from "./search.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @master-ai/shared test` → PASS. Then `pnpm --filter @master-ai/shared typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/links.ts packages/shared/src/search.ts packages/shared/src/index.ts packages/shared/src/links.test.ts
git commit -m "master-ai: контракты Link и SearchHit в shared"
```

---

### Task 2: Таблица `links`, FTS5-таблица и извлечение текста из ProseMirror

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Create (generate + hand-edit): `packages/server/drizzle/0002_*.sql` and `packages/server/drizzle/meta/*`
- Create: `packages/server/src/services/prosemirror-text.ts`
- Test: `packages/server/src/services/prosemirror-text.test.ts`
- Test: `packages/server/src/db/links-fts-schema.test.ts`

**Interfaces:**
- Consumes: `createDb` from `../db/client.js` (applies migrations).
- Produces: `links` Drizzle table; live virtual table `documents_fts(doc_id, campaign_id, type, title, body)`; `proseMirrorToText(doc: unknown): string`.

- [ ] **Step 1: Add the `links` table to `schema.ts`**

Append to `packages/server/src/db/schema.ts`:
```ts
export const links = sqliteTable("links", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id").notNull(),
  fromDocId: text("from_doc_id").notNull(),
  toDocId: text("to_doc_id").notNull(),
  kind: text("kind").notNull(),
});
```

- [ ] **Step 2: Generate the migration for the new table**

Run (from `packages/server`): `pnpm exec drizzle-kit generate`
Expected: writes `drizzle/0002_*.sql` containing `CREATE TABLE \`links\` (...)` and updates `drizzle/meta/`. Confirm the file exists: `ls packages/server/drizzle/0002_*.sql`.

- [ ] **Step 3: Hand-append the FTS5 virtual table to that same 0002 migration file**

Append to the generated `drizzle/0002_*.sql` (after the `links` CREATE), preceded by a statement breakpoint line:
```sql
--> statement-breakpoint
CREATE VIRTUAL TABLE `documents_fts` USING fts5(
  doc_id UNINDEXED,
  campaign_id UNINDEXED,
  type UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```
Rationale: drizzle-kit cannot express FTS5 virtual tables, so it is created with raw SQL inside the migration the migrator runs. The snapshot does not reference it; future `generate` diffs schema.ts↔snapshot only, so it will not try to drop it.

- [ ] **Step 4: Write the failing tests**

`packages/server/src/services/prosemirror-text.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { proseMirrorToText } from "./prosemirror-text.js";

describe("proseMirrorToText", () => {
  it("собирает текст из вложенных узлов", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Барон" }, { type: "text", text: " фон Кройц" }] },
        { type: "paragraph", content: [{ type: "text", text: "Мрачный аристократ." }] },
      ],
    };
    expect(proseMirrorToText(doc)).toBe("Барон фон Кройц\nМрачный аристократ.");
  });

  it("на null / пустом возвращает пустую строку", () => {
    expect(proseMirrorToText(null)).toBe("");
    expect(proseMirrorToText({ type: "doc", content: [] })).toBe("");
  });
});
```

`packages/server/src/db/links-fts-schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client.js";

describe("миграция links + FTS5", () => {
  it("создаёт таблицу links и виртуальную documents_fts", () => {
    const { db } = createDb(":memory:");
    const tables = db.all(
      sql`SELECT name FROM sqlite_master WHERE type IN ('table') AND name IN ('links','documents_fts')`,
    ) as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain("links");
    expect(names).toContain("documents_fts");
  });

  it("FTS5 матчит вставленную строку с кириллицей", () => {
    const { db } = createDb(":memory:");
    db.run(sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES ('d1','c1','npc','Барон','Мрачный аристократ из замка')`);
    const rows = db.all(
      sql`SELECT doc_id FROM documents_fts WHERE documents_fts MATCH ${'"аристократ"'}`,
    ) as { doc_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].doc_id).toBe("d1");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm --filter @master-ai/server test prosemirror-text links-fts-schema`
Expected: FAIL — `./prosemirror-text.js` missing; FTS table absent if migration not applied.

- [ ] **Step 6: Implement `proseMirrorToText`**

`packages/server/src/services/prosemirror-text.ts`:
```ts
// Извлекает плоский текст из ProseMirror-документа для индексации в FTS.
// Текстовые узлы внутри одного блока склеиваются, блоки разделяются \n.
type PMNode = { type?: string; text?: string; content?: PMNode[] };

export function proseMirrorToText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const blocks: string[] = [];

  function block(node: PMNode): string {
    let s = "";
    if (typeof node.text === "string") s += node.text;
    for (const child of node.content ?? []) s += block(child);
    return s;
  }

  const root = doc as PMNode;
  for (const node of root.content ?? []) {
    const text = block(node).trim();
    if (text) blocks.push(text);
  }
  return blocks.join("\n");
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @master-ai/server test prosemirror-text links-fts-schema` → PASS.
Then `pnpm --filter @master-ai/server typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/drizzle packages/server/src/services/prosemirror-text.ts packages/server/src/services/prosemirror-text.test.ts packages/server/src/db/links-fts-schema.test.ts
git commit -m "master-ai: таблица links, FTS5-индекс documents_fts и извлечение текста ProseMirror"
```

---

### Task 3: Индексация FTS в `DocumentService` + `SearchService`

**Files:**
- Modify: `packages/server/src/services/documents.ts`
- Create: `packages/server/src/services/search.ts`
- Test: `packages/server/src/services/documents.test.ts` (add cases)
- Test: `packages/server/src/services/search.test.ts`

**Interfaces:**
- Consumes: `proseMirrorToText` from `./prosemirror-text.js`; `documents` table; `sql` from `drizzle-orm`; `SearchHit` from `@master-ai/shared`.
- Produces: `DocumentService.create`/`update` keep `documents_fts` in sync; `SearchService` with `search(campaignId, query): SearchHit[]` and `reindexAll(): void`.

- [ ] **Step 1: Write the failing test for FTS maintenance + search**

`packages/server/src/services/search.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";
import { SearchService } from "./search.js";

function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe("SearchService", () => {
  it("находит документ по слову из тела", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("Мрачный аристократ из замка") });
    const hits = search.search("c1", "аристократ");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("Барон");
    expect(hits[0].type).toBe("npc");
  });

  it("находит по заголовку", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "location", title: "Таверна Полумесяц", contentJson: doc("дым и эль") });
    expect(search.search("c1", "Полумесяц")).toHaveLength(1);
  });

  it("не находит документы из другой кампании", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("аристократ") });
    expect(search.search("c2", "аристократ")).toHaveLength(0);
  });

  it("update переиндексирует тело", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    const d = documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("старый текст") });
    documents.update(d.id, { contentJson: doc("новое слово фисштибрамс") });
    expect(search.search("c1", "старый")).toHaveLength(0);
    expect(search.search("c1", "фисштибрамс")).toHaveLength(1);
  });

  it("пустой запрос возвращает пусто", () => {
    const { db } = createDb(":memory:");
    const search = new SearchService(db);
    expect(search.search("c1", "   ")).toHaveLength(0);
  });

  it("reindexAll восстанавливает индекс из таблицы documents", () => {
    const { db } = createDb(":memory:");
    const documents = new DocumentService(db);
    const search = new SearchService(db);
    documents.create({ campaignId: "c1", type: "npc", title: "Барон", contentJson: doc("аристократ") });
    // имитируем потерю индекса
    db.run((await import("drizzle-orm")).sql`DELETE FROM documents_fts`);
    expect(search.search("c1", "аристократ")).toHaveLength(0);
    search.reindexAll();
    expect(search.search("c1", "аристократ")).toHaveLength(1);
  });
});
```
Note for implementer: the dynamic `await import` inside the last test is awkward — instead add `import { sql } from "drizzle-orm";` at the top of the test file and use `db.run(sql\`DELETE FROM documents_fts\`)`. Write it that way.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @master-ai/server test search`
Expected: FAIL — `./search.js` missing; create does not populate FTS.

- [ ] **Step 3: Add FTS maintenance to `DocumentService`**

In `packages/server/src/services/documents.ts`:
- Add imports at top:
```ts
import { sql } from "drizzle-orm";
import { proseMirrorToText } from "./prosemirror-text.js";
```
- Add a private helper and call it from `create` and `update`:
```ts
  private indexFts(row: { id: string; campaignId: string; type: string; title: string; contentJson: string }): void {
    const body = proseMirrorToText(JSON.parse(row.contentJson));
    this.db.run(sql`DELETE FROM documents_fts WHERE doc_id = ${row.id}`);
    this.db.run(
      sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES (${row.id}, ${row.campaignId}, ${row.type}, ${row.title}, ${body})`,
    );
  }
```
- In `create`, after `this.db.insert(documents).values(row).run();` add `this.indexFts(row);`
- In `update`, after the `this.db.update(...).run()`, reindex from the fresh row:
```ts
    const updated = this.get(id);
    if (updated) {
      this.indexFts({
        id: updated.id,
        campaignId: updated.campaignId,
        type: updated.type,
        title: updated.title,
        contentJson: JSON.stringify(updated.contentJson),
      });
    }
    return updated;
```
(Replace the final `return this.get(id);` in `update` accordingly; do not call `get` twice.)

- [ ] **Step 4: Implement `SearchService`**

`packages/server/src/services/search.ts`:
```ts
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SearchHit } from "@master-ai/shared";
import { documents } from "../db/schema.js";
import { proseMirrorToText } from "./prosemirror-text.js";

// Превращает пользовательский запрос в безопасную FTS5 MATCH-строку:
// каждый токен — фразой в кавычках (внутренние кавычки удваиваются), термы через AND.
function toMatchQuery(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

export class SearchService {
  constructor(private db: BetterSQLite3Database) {}

  search(campaignId: string, query: string): SearchHit[] {
    const match = toMatchQuery(query);
    if (!match) return [];
    const rows = this.db.all(
      sql`SELECT doc_id, type, title, snippet(documents_fts, 4, '[', ']', '…', 10) AS snippet
          FROM documents_fts
          WHERE campaign_id = ${campaignId} AND documents_fts MATCH ${match}
          ORDER BY bm25(documents_fts)`,
    ) as { doc_id: string; type: string; title: string; snippet: string }[];
    return rows.map((r) => ({ docId: r.doc_id, type: r.type, title: r.title, snippet: r.snippet }));
  }

  // Полная перестройка индекса из таблицы documents (для документов, созданных до появления FTS).
  reindexAll(): void {
    this.db.run(sql`DELETE FROM documents_fts`);
    const rows = this.db.select().from(documents).all();
    for (const row of rows) {
      const body = proseMirrorToText(JSON.parse(row.contentJson));
      this.db.run(
        sql`INSERT INTO documents_fts (doc_id, campaign_id, type, title, body) VALUES (${row.id}, ${row.campaignId}, ${row.type}, ${row.title}, ${body})`,
      );
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @master-ai/server test search documents` → PASS (all existing documents tests still green).
Then `pnpm --filter @master-ai/server typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/documents.ts packages/server/src/services/search.ts packages/server/src/services/search.test.ts packages/server/src/services/documents.test.ts
git commit -m "master-ai: индексация FTS в DocumentService и SearchService"
```

---

### Task 4: `LinkService`

**Files:**
- Create: `packages/server/src/services/links.ts`
- Test: `packages/server/src/services/links.test.ts`

**Interfaces:**
- Consumes: `links` and `documents` tables; `NewLink`, `Link`, `DocumentLinks` from `@master-ai/shared`.
- Produces: `LinkService` with `create(input: NewLink): Link`, `listForDocument(docId: string): DocumentLinks`, `delete(id: string): boolean`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/services/links.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";
import { LinkService } from "./links.js";

function setup() {
  const { db } = createDb(":memory:");
  const documents = new DocumentService(db);
  const links = new LinkService(db);
  const a = documents.create({ campaignId: "c1", type: "npc", title: "Барон" });
  const b = documents.create({ campaignId: "c1", type: "location", title: "Замок" });
  return { documents, links, a, b };
}

describe("LinkService", () => {
  it("create сохраняет связь", () => {
    const { links, a, b } = setup();
    const l = links.create({ campaignId: "c1", fromDocId: a.id, toDocId: b.id, kind: "обитает в" });
    expect(l.id).toBeTruthy();
    expect(l.kind).toBe("обитает в");
  });

  it("listForDocument разделяет исходящие и обратные связи с данными документа", () => {
    const { links, a, b } = setup();
    links.create({ campaignId: "c1", fromDocId: a.id, toDocId: b.id, kind: "обитает в" });
    const fromA = links.listForDocument(a.id);
    expect(fromA.outgoing).toHaveLength(1);
    expect(fromA.outgoing[0].document.title).toBe("Замок");
    expect(fromA.incoming).toHaveLength(0);
    const fromB = links.listForDocument(b.id);
    expect(fromB.incoming).toHaveLength(1);
    expect(fromB.incoming[0].document.title).toBe("Барон");
    expect(fromB.incoming[0].kind).toBe("обитает в");
  });

  it("delete удаляет связь", () => {
    const { links, a, b } = setup();
    const l = links.create({ campaignId: "c1", fromDocId: a.id, toDocId: b.id, kind: "обитает в" });
    expect(links.delete(l.id)).toBe(true);
    expect(links.listForDocument(a.id).outgoing).toHaveLength(0);
    expect(links.delete(l.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @master-ai/server test links`
Expected: FAIL — `./links.js` missing.

- [ ] **Step 3: Implement `LinkService`**

`packages/server/src/services/links.ts`:
```ts
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Link, NewLink, DocumentLinks, LinkedDocument } from "@master-ai/shared";
import { links, documents } from "../db/schema.js";

export class LinkService {
  constructor(private db: BetterSQLite3Database) {}

  create(input: NewLink): Link {
    const row = { id: randomUUID(), ...input };
    this.db.insert(links).values(row).run();
    return row;
  }

  listForDocument(docId: string): DocumentLinks {
    const rows = this.db.select().from(links).all();
    const outgoingRows = rows.filter((l) => l.fromDocId === docId);
    const incomingRows = rows.filter((l) => l.toDocId === docId);

    const otherIds = [
      ...outgoingRows.map((l) => l.toDocId),
      ...incomingRows.map((l) => l.fromDocId),
    ];
    const docs = otherIds.length
      ? this.db.select().from(documents).where(inArray(documents.id, otherIds)).all()
      : [];
    const byId = new Map(docs.map((d) => [d.id, d]));

    const view = (linkId: string, kind: string, otherId: string): LinkedDocument | null => {
      const d = byId.get(otherId);
      if (!d) return null;
      return { linkId, kind, document: { id: d.id, type: d.type, title: d.title } };
    };

    return {
      outgoing: outgoingRows
        .map((l) => view(l.id, l.kind, l.toDocId))
        .filter((x): x is LinkedDocument => x !== null),
      incoming: incomingRows
        .map((l) => view(l.id, l.kind, l.fromDocId))
        .filter((x): x is LinkedDocument => x !== null),
    };
  }

  delete(id: string): boolean {
    const res = this.db.delete(links).where(eq(links.id, id)).run();
    return res.changes > 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @master-ai/server test links` → PASS. `pnpm --filter @master-ai/server typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/links.ts packages/server/src/services/links.test.ts
git commit -m "master-ai: LinkService — связи документов с обратными ссылками"
```

---

### Task 5: Эндпоинты поиска и связей + переиндексация при старте

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/main.ts`
- Test: `packages/server/src/app.test.ts` (add cases)

**Interfaces:**
- Consumes: `SearchService`, `LinkService`, `NewLinkSchema`.
- Produces routes: `GET /api/campaigns/:id/search?q=`, `POST /api/campaigns/:id/links`, `GET /api/documents/:id/links`, `DELETE /api/links/:id`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/app.test.ts` (follow the existing inject style; if there is a shared `buildApp(...)` setup helper, reuse it). Reference pattern:
```ts
it("search находит документ по контенту", async () => {
  const app = buildApp({ db: createDb(":memory:").db });
  const c = await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } });
  const campaignId = c.json().id;
  await app.inject({
    method: "POST",
    url: "/api/documents",
    payload: { campaignId, type: "npc", title: "Барон", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "аристократ из замка" }] }] } },
  });
  const res = await app.inject({ method: "GET", url: `/api/campaigns/${campaignId}/search?q=${encodeURIComponent("аристократ")}` });
  expect(res.statusCode).toBe(200);
  const hits = res.json();
  expect(hits).toHaveLength(1);
  expect(hits[0].title).toBe("Барон");
});

it("создаёт и перечисляет связи, отдаёт обратные ссылки", async () => {
  const app = buildApp({ db: createDb(":memory:").db });
  const campaignId = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json().id;
  const mk = async (title: string, type: string) =>
    (await app.inject({ method: "POST", url: "/api/documents", payload: { campaignId, type, title } })).json().id;
  const a = await mk("Барон", "npc");
  const b = await mk("Замок", "location");
  const created = await app.inject({ method: "POST", url: `/api/campaigns/${campaignId}/links`, payload: { campaignId, fromDocId: a, toDocId: b, kind: "обитает в" } });
  expect(created.statusCode).toBe(201);
  const linksB = await app.inject({ method: "GET", url: `/api/documents/${b}/links` });
  expect(linksB.json().incoming).toHaveLength(1);
  expect(linksB.json().incoming[0].document.title).toBe("Барон");
});

it("POST link с пустым kind → 400", async () => {
  const app = buildApp({ db: createDb(":memory:").db });
  const campaignId = (await app.inject({ method: "POST", url: "/api/campaigns", payload: { name: "К" } })).json().id;
  const res = await app.inject({ method: "POST", url: `/api/campaigns/${campaignId}/links`, payload: { campaignId, fromDocId: "a", toDocId: "b", kind: "" } });
  expect(res.statusCode).toBe(400);
});

it("DELETE несуществующей связи → 404", async () => {
  const app = buildApp({ db: createDb(":memory:").db });
  const res = await app.inject({ method: "DELETE", url: "/api/links/нет-такой" });
  expect(res.statusCode).toBe(404);
});
```
Implementer note: match the exact construction used by the existing app.test.ts (imports of `buildApp`/`createDb`, whether a helper builds the app). Do not introduce a second app-construction style.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @master-ai/server test app`
Expected: FAIL — routes 404 / not registered.

- [ ] **Step 3: Register the services and routes in `app.ts`**

- Add imports:
```ts
import { NewLinkSchema } from "@master-ai/shared";
import { LinkService } from "./services/links.js";
import { SearchService } from "./services/search.js";
```
(Add `NewLinkSchema` to the existing `@master-ai/shared` import group rather than a duplicate import line.)
- After the existing service constructions add:
```ts
  const linksSvc = new LinkService(deps.db);
  const searchSvc = new SearchService(deps.db);
```
- Add routes (place near the documents routes):
```ts
  app.get("/api/campaigns/:id/search", (req) => {
    const { id } = req.params as { id: string };
    const { q } = req.query as { q?: string };
    return searchSvc.search(id, q ?? "");
  });

  app.post("/api/campaigns/:id/links", (req, reply) => {
    const parsed = NewLinkSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return reply.code(201).send(linksSvc.create(parsed.data));
  });

  app.get<IdParams>("/api/documents/:id/links", (req) => {
    const { id } = req.params;
    return linksSvc.listForDocument(id);
  });

  app.delete<IdParams>("/api/links/:id", (req, reply) => {
    const { id } = req.params;
    if (!linksSvc.delete(id)) return reply.code(404).send({ error: "связь не найдена" });
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Reindex on startup in `main.ts`**

In `packages/server/src/main.ts`, after `const { db } = createDb(...)` and before/after `buildApp`, add a one-time reindex so documents created before FTS existed become searchable:
```ts
import { SearchService } from "./services/search.js";
// ...
new SearchService(db).reindexAll();
```
Place the `reindexAll()` call after `createDb` and before `app.listen`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @master-ai/server test app` → PASS (all prior app tests still green).
Then `pnpm --filter @master-ai/server typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/main.ts packages/server/src/app.test.ts
git commit -m "master-ai: эндпоинты поиска и связей, переиндексация FTS при старте"
```

---

### Task 6: Веб — глобальный поиск на странице кампании

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Create: `packages/web/src/pages/SearchBox.tsx`
- Modify: `packages/web/src/pages/CampaignPage.tsx`
- Test: `packages/web/src/pages/SearchBox.test.tsx`
- Modify: `packages/web/src/pages/CampaignPage.test.tsx` (mock the new api method)

**Interfaces:**
- Consumes: `api.search`; `SearchHit`, `Link`, `NewLink`, `DocumentLinks` from `@master-ai/shared`.
- Produces: `SearchBox` component; `api.search`, `api.createLink`, `api.listDocumentLinks`, `api.deleteLink`.

- [ ] **Step 1: Add api-client methods**

In `packages/web/src/api/client.ts`:
- Extend the `@master-ai/shared` import with `SearchHit, Link, NewLink, DocumentLinks`.
- Add to the `api` object:
```ts
  search: (campaignId: string, q: string) =>
    request<SearchHit[]>(`/api/campaigns/${campaignId}/search?q=${encodeURIComponent(q)}`),
  createLink: (input: NewLink) =>
    request<Link>(`/api/campaigns/${input.campaignId}/links`, { method: "POST", body: JSON.stringify(input) }),
  listDocumentLinks: (docId: string) =>
    request<DocumentLinks>(`/api/documents/${docId}/links`),
  deleteLink: (id: string) =>
    fetch(`/api/links/${id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) throw new ApiError(res.status, res.statusText);
    }),
```
(`deleteLink` returns 204 with no body, so it does not use `request`.)

- [ ] **Step 2: Write the failing test**

`packages/web/src/pages/SearchBox.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SearchBox } from "./SearchBox.js";
import { ToastProvider } from "../ui/toast.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  api: { search: vi.fn() },
  ApiError: class extends Error {},
}));

beforeEach(() => vi.clearAllMocks());

function renderBox() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <SearchBox campaignId="c1" />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("SearchBox", () => {
  it("показывает результаты поиска", async () => {
    (api.search as ReturnType<typeof vi.fn>).mockResolvedValue([
      { docId: "d1", type: "npc", title: "Барон", snippet: "…аристократ…" },
    ]);
    renderBox();
    await userEvent.type(screen.getByPlaceholderText(/поиск/i), "барон");
    expect(await screen.findByText("Барон")).toBeInTheDocument();
    expect(api.search).toHaveBeenCalledWith("c1", "барон");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @master-ai/web test SearchBox`
Expected: FAIL — `./SearchBox.js` missing.

- [ ] **Step 4: Implement `SearchBox`**

`packages/web/src/pages/SearchBox.tsx`:
```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import type { SearchHit } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function SearchBox({ campaignId }: { campaignId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const { showToast } = useToast();

  async function run(value: string) {
    setQ(value);
    if (!value.trim()) {
      setHits([]);
      return;
    }
    try {
      setHits(await api.search(campaignId, value));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка поиска");
    }
  }

  return (
    <div className="search-box">
      <input
        type="search"
        placeholder="Поиск по кампании…"
        value={q}
        onChange={(e) => run(e.target.value)}
      />
      {hits.length > 0 && (
        <ul className="search-results">
          {hits.map((h) => (
            <li key={h.docId}>
              <Link to={`/documents/${h.docId}`}>{h.title}</Link>
              <span className="search-type"> · {h.type}</span>
              {h.snippet && <div className="search-snippet">{h.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Integrate into `CampaignPage` and fix its test**

- In `CampaignPage.tsx`: import `SearchBox` (`import { SearchBox } from "./SearchBox.js";`) and render `<SearchBox campaignId={campaignId!} />` near the top of the campaign content (e.g. just under the heading, above WorkshopPanel).
- In `CampaignPage.test.tsx`: the api mock must include `search: vi.fn().mockResolvedValue([])` so SearchBox does not crash if it triggers a call. (SearchBox only calls on input, so a default mock is sufficient; add the property to the mocked `api` object.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @master-ai/web test SearchBox CampaignPage` → PASS.
Then full web suite `pnpm --filter @master-ai/web test` and `pnpm --filter @master-ai/web typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/client.ts packages/web/src/pages/SearchBox.tsx packages/web/src/pages/CampaignPage.tsx packages/web/src/pages/SearchBox.test.tsx packages/web/src/pages/CampaignPage.test.tsx
git commit -m "master-ai: глобальный поиск по кампании в вебе"
```

---

### Task 7: Веб — панель связей в редакторе документа

**Files:**
- Create: `packages/web/src/pages/LinksPanel.tsx`
- Modify: `packages/web/src/pages/DocumentPage.tsx`
- Test: `packages/web/src/pages/LinksPanel.test.tsx`
- Modify: `packages/web/src/pages/DocumentPage.test.tsx` (mock new api methods)

**Interfaces:**
- Consumes: `api.listDocumentLinks`, `api.createLink`, `api.deleteLink`, `api.listCampaignDocuments`; `DocumentLinks` from `@master-ai/shared`.
- Produces: `LinksPanel` component rendered in `DocumentPage`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/pages/LinksPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LinksPanel } from "./LinksPanel.js";
import { ToastProvider } from "../ui/toast.js";
import { api } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  api: {
    listDocumentLinks: vi.fn(),
    listCampaignDocuments: vi.fn(),
    createLink: vi.fn(),
    deleteLink: vi.fn(),
  },
  ApiError: class extends Error {},
}));

beforeEach(() => vi.clearAllMocks());

function renderPanel() {
  render(
    <ToastProvider>
      <MemoryRouter>
        <LinksPanel campaignId="c1" documentId="a" />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("LinksPanel", () => {
  it("показывает исходящие и обратные связи", async () => {
    (api.listDocumentLinks as ReturnType<typeof vi.fn>).mockResolvedValue({
      outgoing: [{ linkId: "l1", kind: "обитает в", document: { id: "b", type: "location", title: "Замок" } }],
      incoming: [{ linkId: "l2", kind: "знает", document: { id: "c", type: "npc", title: "Шпион" } }],
    });
    (api.listCampaignDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText("Замок")).toBeInTheDocument();
    expect(await screen.findByText("Шпион")).toBeInTheDocument();
  });

  it("удаляет связь по кнопке", async () => {
    (api.listDocumentLinks as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        outgoing: [{ linkId: "l1", kind: "обитает в", document: { id: "b", type: "location", title: "Замок" } }],
        incoming: [],
      })
      .mockResolvedValueOnce({ outgoing: [], incoming: [] });
    (api.listCampaignDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.deleteLink as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText("Замок");
    await userEvent.click(screen.getByRole("button", { name: /удалить/i }));
    await waitFor(() => expect(api.deleteLink).toHaveBeenCalledWith("l1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @master-ai/web test LinksPanel`
Expected: FAIL — `./LinksPanel.js` missing.

- [ ] **Step 3: Implement `LinksPanel`**

`packages/web/src/pages/LinksPanel.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DocumentLinks, Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

export function LinksPanel({ campaignId, documentId }: { campaignId: string; documentId: string }) {
  const [data, setData] = useState<DocumentLinks>({ outgoing: [], incoming: [] });
  const [candidates, setCandidates] = useState<Document[]>([]);
  const [targetId, setTargetId] = useState("");
  const [kind, setKind] = useState("");
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api.listDocumentLinks(documentId));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка загрузки связей");
    }
  }, [documentId, showToast]);

  useEffect(() => {
    load();
    api
      .listCampaignDocuments(campaignId)
      .then((docs) => setCandidates(docs.filter((d) => d.id !== documentId)))
      .catch(() => {});
  }, [campaignId, documentId, load]);

  async function addLink() {
    if (!targetId || !kind.trim()) return;
    try {
      await api.createLink({ campaignId, fromDocId: documentId, toDocId: targetId, kind });
      setTargetId("");
      setKind("");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось создать связь");
    }
  }

  async function remove(linkId: string) {
    try {
      await api.deleteLink(linkId);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Не удалось удалить связь");
    }
  }

  return (
    <aside className="links-panel">
      <h3>Связи</h3>
      <section>
        <h4>Исходящие</h4>
        <ul>
          {data.outgoing.map((l) => (
            <li key={l.linkId}>
              <Link to={`/documents/${l.document.id}`}>{l.document.title}</Link>
              <span> · {l.kind}</span>
              <button type="button" onClick={() => remove(l.linkId)}>удалить</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Обратные ссылки</h4>
        <ul>
          {data.incoming.map((l) => (
            <li key={l.linkId}>
              <Link to={`/documents/${l.document.id}`}>{l.document.title}</Link>
              <span> · {l.kind}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="links-add">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— документ —</option>
          {candidates.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
        <input placeholder="тип связи" value={kind} onChange={(e) => setKind(e.target.value)} />
        <button type="button" onClick={addLink}>Связать</button>
      </section>
    </aside>
  );
}
```

- [ ] **Step 4: Integrate into `DocumentPage` and fix its test**

- In `DocumentPage.tsx`: render `<LinksPanel campaignId={doc.campaignId} documentId={doc.id} />` where the loaded document is available (after the document loads; guard on the doc being present). Import via `./LinksPanel.js`.
- In `DocumentPage.test.tsx`: add to the mocked `api` object: `listDocumentLinks: vi.fn().mockResolvedValue({ outgoing: [], incoming: [] })` and `listCampaignDocuments: vi.fn().mockResolvedValue([])` (and `createLink`/`deleteLink` as `vi.fn()`), so the panel's mount effect resolves cleanly and existing DocumentPage tests stay green.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @master-ai/web test LinksPanel DocumentPage` → PASS.
Then full web suite `pnpm --filter @master-ai/web test` and `pnpm --filter @master-ai/web typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/LinksPanel.tsx packages/web/src/pages/DocumentPage.tsx packages/web/src/pages/LinksPanel.test.tsx packages/web/src/pages/DocumentPage.test.tsx
git commit -m "master-ai: панель связей документа в вебе"
```

---

### Task 8: Сквозная проверка (controller, verification-only)

**Not an implementer task** — the controller runs this after Task 7.

- [ ] Full suite green: `pnpm -r test` and `pnpm -r typecheck`.
- [ ] Live HTTP e2e with a started server: create campaign + two documents; `GET /api/campaigns/:id/search?q=` finds a document by body text and by title (Cyrillic intact); `POST /api/campaigns/:id/links` then `GET /api/documents/:id/links` shows the backlink with the connected document's title; `DELETE /api/links/:id` returns 204 and the link disappears; updating a document's content reindexes (old term no longer found, new term found).
- [ ] Confirm `reindexAll()` at startup indexes pre-existing documents (point the server at the existing dev DB and search for a known older document).

## Self-Review (author checklist — completed)

- **Spec coverage:** Link model (id, campaignId, fromDocId, toDocId, kind) — Tasks 1,2,4. FTS5 over title + extracted content text — Tasks 2,3. `links`/`search` routes from the spec's `routes/` list — Task 5. Global search + linking in UI — Tasks 6,7. ✅
- **Placeholder scan:** every code step contains complete code; no TBD/TODO. ✅
- **Type consistency:** `SearchHit {docId,type,title,snippet}`, `LinkedDocument {linkId,kind,document:{id,type,title}}`, `DocumentLinks {outgoing,incoming}`, `NewLink {campaignId,fromDocId,toDocId,kind}` used identically across server services, routes, api client, and web components. FTS column order `doc_id, campaign_id, type, title, body` is fixed; `snippet(documents_fts, 4, …)` targets `body` (index 4); `bm25` ordering matches. ✅
- **Migration caveat documented:** FTS5 created via hand-appended raw SQL in the drizzle-kit-generated 0002 migration; not in schema.ts/snapshot — Task 2 Step 3. ✅
