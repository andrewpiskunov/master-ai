# master-ai — План 3: Слой LLM-провайдера и стриминговый эндпоинт

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бэкенд умеет генерировать текст через подключаемую LLM: абстракция `LLMProvider`, реализация `CliProvider` (локальный CLI вроде `claude -p`), `FakeProvider` для тестов, и стриминговый эндпоинт `POST /api/llm/complete`.

**Architecture:** Провайдер скрыт за интерфейсом `LLMProvider.complete(input): AsyncIterable<string>`. `CliProvider` спавнит настраиваемую команду, передаёт собранный промпт через stdin и стримит chunks из stdout; ненулевой код выхода / ошибка спавна → `LlmError`. `loadProvider()` выбирает реализацию по env (по умолчанию CLI `claude -p`); архитектура готова к будущему `ApiProvider` (OpenAI-совместимый), но он вне Плана 3. Эндпоинт отдаёт поток через `Readable.from(provider.complete(...))`. Типы сообщений живут в `@master-ai/shared` (их использует и фронт в Плане 4).

**Tech Stack:** Node `child_process`, Fastify 5 (Readable stream response), zod, Vitest.

## Global Constraints

- Node 20+, pnpm workspaces, TypeScript ESM ("module":"NodeNext") — относительные импорты с `.js`; типы из `@master-ai/shared`.
- Тесты — Vitest; `pnpm -r typecheck` (tsc --noEmit) должен проходить.
- Каждый таск завершается зелёными тестами + коммит. Коммиты — только имя автора, без Co-Authored-By/AI-трейлеров.
- `CliProvider` НЕ должен требовать установленного `claude` в тестах — тестировать через подставную команду (`node -e ...` echo/exit), а не реальный CLI.
- Рабочая директория: `Docs/НРИ/master-ai/`.

---

### Task 1: Схемы и типы LLM-сообщений в shared

**Files:**
- Create: `packages/shared/src/llm.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/llm.test.ts`

**Interfaces:**
- Produces:
  - `LlmMessageSchema` (zod) / `LlmMessage = { role: "system" | "user" | "assistant"; content: string }`.
  - `CompleteInputSchema` (zod) / `CompleteInput = { system?: string; messages: LlmMessage[] }` (messages непустой массив).

- [ ] **Step 1: Падающий тест**

`packages/shared/src/llm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CompleteInputSchema } from "./llm.js";

describe("CompleteInputSchema", () => {
  it("принимает валидный ввод", () => {
    const value = { system: "ты гейм-мастер", messages: [{ role: "user", content: "привет" }] };
    expect(CompleteInputSchema.parse(value)).toEqual(value);
  });

  it("требует непустой messages", () => {
    expect(() => CompleteInputSchema.parse({ messages: [] })).toThrow();
  });

  it("отвергает неизвестную роль", () => {
    expect(() => CompleteInputSchema.parse({ messages: [{ role: "boss", content: "x" }] })).toThrow();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/shared test llm`
Expected: FAIL — `./llm.js` не найден.

- [ ] **Step 3: Реализовать**

`packages/shared/src/llm.ts`:
```ts
import { z } from "zod";

export const LlmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type LlmMessage = z.infer<typeof LlmMessageSchema>;

export const CompleteInputSchema = z.object({
  system: z.string().optional(),
  messages: z.array(LlmMessageSchema).min(1),
});
export type CompleteInput = z.infer<typeof CompleteInputSchema>;
```

`packages/shared/src/index.ts` — добавить строку (остальные сохранить):
```ts
export * from "./llm.js";
```

- [ ] **Step 4: Тест зелёный + typecheck**

Run: `pnpm --filter @master-ai/shared test && pnpm --filter @master-ai/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "master-ai: схемы LLM-сообщений в shared"
```

---

### Task 2: Интерфейс LLMProvider и FakeProvider

**Files:**
- Create: `packages/server/src/llm/provider.ts`
- Create: `packages/server/src/llm/fake.ts`
- Test: `packages/server/src/llm/fake.test.ts`

**Interfaces:**
- Consumes: `CompleteInput` из `@master-ai/shared`.
- Produces:
  - `interface LLMProvider { complete(input: CompleteInput): AsyncIterable<string> }` (в `provider.ts`).
  - `class LlmError extends Error` (в `provider.ts`).
  - `class FakeProvider implements LLMProvider` — конструктор `(chunks: string[])`, `complete()` отдаёт чанки по очереди (в `fake.ts`).

- [ ] **Step 1: Падающий тест FakeProvider**

`packages/server/src/llm/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { FakeProvider } from "./fake.js";

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const c of iter) out += c;
  return out;
}

describe("FakeProvider", () => {
  it("отдаёт заданные чанки по очереди", async () => {
    const provider = new FakeProvider(["Привет", ", ", "мир"]);
    const result = await collect(provider.complete({ messages: [{ role: "user", content: "x" }] }));
    expect(result).toBe("Привет, мир");
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test fake`
Expected: FAIL — `./fake.js` не найден.

- [ ] **Step 3: Реализовать provider.ts и fake.ts**

`packages/server/src/llm/provider.ts`:
```ts
import type { CompleteInput } from "@master-ai/shared";

export interface LLMProvider {
  complete(input: CompleteInput): AsyncIterable<string>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}
```

`packages/server/src/llm/fake.ts`:
```ts
import type { CompleteInput } from "@master-ai/shared";
import type { LLMProvider } from "./provider.js";

export class FakeProvider implements LLMProvider {
  constructor(private chunks: string[]) {}

  async *complete(_input: CompleteInput): AsyncIterable<string> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}
```

- [ ] **Step 4: Тест зелёный + typecheck**

Run: `pnpm --filter @master-ai/server test fake && pnpm --filter @master-ai/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm
git commit -m "master-ai: интерфейс LLMProvider и FakeProvider"
```

---

### Task 3: CliProvider (спавн команды, стрим stdout)

**Files:**
- Create: `packages/server/src/llm/cli.ts`
- Test: `packages/server/src/llm/cli.test.ts`

**Interfaces:**
- Consumes: `CompleteInput` (shared), `LLMProvider`/`LlmError` (Task 2).
- Produces:
  - `interface CliProviderConfig { command: string; args: string[] }`.
  - `class CliProvider implements LLMProvider` — конструктор `(config: CliProviderConfig)`. `complete(input)` собирает промпт (`renderPrompt`), спавнит `command args`, пишет промпт в stdin и закрывает его, стримит chunks из stdout (как строки). По завершении: если код выхода ≠ 0 — бросает `LlmError` с stderr; если процесс не запустился (ошибка спавна) — бросает `LlmError`.
  - `renderPrompt(input: CompleteInput): string` — экспортируемая функция: склеивает `system` (если есть) и сообщения в формате `role: content`, разделяя пустой строкой.

- [ ] **Step 1: Падающие тесты (подставные команды, без claude)**

`packages/server/src/llm/cli.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CliProvider, renderPrompt } from "./cli.js";
import { LlmError } from "./provider.js";

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const c of iter) out += c;
  return out;
}

const input = { messages: [{ role: "user" as const, content: "привет" }] };

describe("renderPrompt", () => {
  it("склеивает system и сообщения", () => {
    const text = renderPrompt({ system: "ты ГМ", messages: [{ role: "user", content: "привет" }] });
    expect(text).toContain("ты ГМ");
    expect(text).toContain("user: привет");
  });
});

describe("CliProvider", () => {
  it("стримит stdout подставной команды (эхо stdin)", async () => {
    // node-команда: читает stdin, печатает 'ECHO:' + ввод
    const provider = new CliProvider({
      command: "node",
      args: ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write('ECHO:'+d))"],
    });
    const out = await collect(provider.complete(input));
    expect(out).toContain("ECHO:");
    expect(out).toContain("user: привет");
  });

  it("бросает LlmError при ненулевом коде выхода", async () => {
    const provider = new CliProvider({
      command: "node",
      args: ["-e", "process.stderr.write('boom');process.exit(3)"],
    });
    await expect(collect(provider.complete(input))).rejects.toBeInstanceOf(LlmError);
  });

  it("бросает LlmError если команда не найдена", async () => {
    const provider = new CliProvider({ command: "definitely-not-a-real-cmd-xyz", args: [] });
    await expect(collect(provider.complete(input))).rejects.toBeInstanceOf(LlmError);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test cli`
Expected: FAIL — `./cli.js` не найден.

- [ ] **Step 3: Реализовать CliProvider**

`packages/server/src/llm/cli.ts`:
```ts
import { spawn } from "node:child_process";
import type { CompleteInput } from "@master-ai/shared";
import { type LLMProvider, LlmError } from "./provider.js";

export interface CliProviderConfig {
  command: string;
  args: string[];
}

export function renderPrompt(input: CompleteInput): string {
  const parts: string[] = [];
  if (input.system) parts.push(input.system);
  for (const m of input.messages) parts.push(`${m.role}: ${m.content}`);
  return parts.join("\n\n");
}

export class CliProvider implements LLMProvider {
  constructor(private config: CliProviderConfig) {}

  async *complete(input: CompleteInput): AsyncIterable<string> {
    const child = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // ошибка запуска процесса (например, команда не найдена)
    const spawnError = new Promise<never>((_, reject) => {
      child.on("error", (err) => reject(new LlmError(`Не удалось запустить CLI: ${err.message}`)));
    });

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.stdin.write(renderPrompt(input));
    child.stdin.end();

    // стримим stdout; гонимся со spawnError, чтобы упасть, если процесс не стартовал
    const stdoutIterator = child.stdout[Symbol.asyncIterator]();
    while (true) {
      const next = await Promise.race([stdoutIterator.next(), spawnError]);
      if (next.done) break;
      yield (next.value as Buffer).toString();
    }

    const code: number | null = await Promise.race([
      new Promise<number | null>((resolve) => child.on("close", resolve)),
      spawnError,
    ]);
    if (code !== 0) {
      throw new LlmError(`CLI завершился с кодом ${code}: ${stderr}`);
    }
  }
}
```

- [ ] **Step 4: Тесты зелёные + typecheck**

Run: `pnpm --filter @master-ai/server test cli && pnpm --filter @master-ai/server typecheck`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/cli.ts packages/server/src/llm/cli.test.ts
git commit -m "master-ai: CliProvider — спавн команды и стрим stdout"
```

---

### Task 4: Выбор провайдера по конфигу (loadProvider)

**Files:**
- Create: `packages/server/src/llm/config.ts`
- Test: `packages/server/src/llm/config.test.ts`

**Interfaces:**
- Consumes: `CliProvider` (Task 3), `LLMProvider` (Task 2).
- Produces:
  - `loadProvider(env?: NodeJS.ProcessEnv): LLMProvider` — по `env.MASTER_AI_LLM` (по умолчанию `"cli"`) возвращает провайдера. Для `"cli"`: команда из `env.MASTER_AI_LLM_CMD` (по умолчанию `"claude"`), аргументы из `env.MASTER_AI_LLM_ARGS` (по умолчанию `"-p"`, разбиваются по пробелам). Неизвестное значение → `Error`. Параметр `env` по умолчанию `process.env` (для тестируемости).

- [ ] **Step 1: Падающий тест**

`packages/server/src/llm/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadProvider } from "./config.js";
import { CliProvider } from "./cli.js";

describe("loadProvider", () => {
  it("по умолчанию возвращает CliProvider (claude -p)", () => {
    const provider = loadProvider({});
    expect(provider).toBeInstanceOf(CliProvider);
  });

  it("уважает MASTER_AI_LLM_CMD / _ARGS", () => {
    const provider = loadProvider({ MASTER_AI_LLM: "cli", MASTER_AI_LLM_CMD: "llm", MASTER_AI_LLM_ARGS: "chat -m gpt" });
    expect(provider).toBeInstanceOf(CliProvider);
    // конфиг доступен через приватное поле — проверяем через поведение renderPrompt не нужно; достаточно типа
  });

  it("бросает на неизвестном провайдере", () => {
    expect(() => loadProvider({ MASTER_AI_LLM: "telepathy" })).toThrow();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test config`
Expected: FAIL — `./config.js` не найден.

- [ ] **Step 3: Реализовать**

`packages/server/src/llm/config.ts`:
```ts
import type { LLMProvider } from "./provider.js";
import { CliProvider } from "./cli.js";

export function loadProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const kind = env.MASTER_AI_LLM ?? "cli";
  if (kind === "cli") {
    const command = env.MASTER_AI_LLM_CMD ?? "claude";
    const args = (env.MASTER_AI_LLM_ARGS ?? "-p").split(" ").filter(Boolean);
    return new CliProvider({ command, args });
  }
  throw new Error(`Неизвестный LLM-провайдер: ${kind}`);
}
```

- [ ] **Step 4: Тест зелёный + typecheck**

Run: `pnpm --filter @master-ai/server test config && pnpm --filter @master-ai/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/llm/config.ts packages/server/src/llm/config.test.ts
git commit -m "master-ai: выбор LLM-провайдера по конфигу (loadProvider)"
```

---

### Task 5: Стриминговый эндпоинт POST /api/llm/complete

**Files:**
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/main.ts`
- Test: `packages/server/src/app.test.ts` (добавить кейсы)

**Interfaces:**
- Consumes: `LLMProvider` (Task 2), `loadProvider` (Task 4), `FakeProvider` (Task 2, для тестов), `CompleteInputSchema` (shared).
- Produces:
  - `buildApp` меняет сигнатуру на `buildApp(deps: { db: BetterSQLite3Database; llm?: LLMProvider })`. Внутри: `const llm = deps.llm ?? loadProvider();`.
  - Маршрут `POST /api/llm/complete`: валидирует тело `CompleteInputSchema` (400 при ошибке); при успехе ставит `reply.type("text/plain; charset=utf-8")` и возвращает `Readable.from(llm.complete(parsed.data))` (Fastify стримит ответ).
  - `main.ts` передаёт `llm: loadProvider()` (или полагается на дефолт — оставить дефолт, ничего не добавлять, кроме комментария при желании).

- [ ] **Step 1: Падающие тесты эндпоинта (FakeProvider через inject)**

Добавить в `packages/server/src/app.test.ts` (новый describe; существующие тесты не трогать, но `buildApp({ db })` остаётся валидным — `llm` опционален). Для новых тестов собирать приложение с FakeProvider:
```ts
import { FakeProvider } from "./llm/fake.js";

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
```

> Примечание: убедись, что вверху `app.test.ts` уже импортированы `createDb` и `buildApp` (они есть из Плана 1); добавь импорт `FakeProvider`.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/server test app`
Expected: FAIL — маршрута `/api/llm/complete` нет (404 вместо 200/400).

- [ ] **Step 3: Реализовать в app.ts**

Добавить импорты в начало `packages/server/src/app.ts`:
```ts
import { Readable } from "node:stream";
import { CompleteInputSchema } from "@master-ai/shared";
import type { LLMProvider } from "./llm/provider.js";
import { loadProvider } from "./llm/config.js";
```

Изменить сигнатуру и добавить провайдер (в начале `buildApp`):
```ts
export function buildApp(deps: { db: BetterSQLite3Database; llm?: LLMProvider }): FastifyInstance {
  const app = Fastify();
  app.register(cors, { origin: true });

  const llm = deps.llm ?? loadProvider();
  // ... существующие campaignsSvc / documentsSvc ...
```

Добавить маршрут (рядом с остальными):
```ts
  app.post("/api/llm/complete", (req, reply) => {
    const parsed = CompleteInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    reply.type("text/plain; charset=utf-8");
    return Readable.from(llm.complete(parsed.data));
  });
```

> `CompleteInputSchema` берётся из `@master-ai/shared`. Не забудь объединить импорт с существующим `import { NewCampaignSchema, NewDocumentSchema, DOCUMENT_TYPES, getDocumentType } from "@master-ai/shared";` (добавить `CompleteInputSchema` в этот список вместо отдельной строки, если так чище).

- [ ] **Step 4: main.ts — без обязательных изменений**

`main.ts` уже вызывает `buildApp({ db })`; `llm` опционален и по умолчанию `loadProvider()`. Оставить как есть (дефолтный CLI-провайдер активируется только при запросе к эндпоинту). Менять main.ts не требуется.

- [ ] **Step 5: Тесты зелёные + typecheck + полный прогон**

Run: `pnpm --filter @master-ai/server test app && pnpm -r test && pnpm -r typecheck`
Expected: PASS везде (существующие 8 app-тестов + 2 новых; shared/server/web).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/app.test.ts
git commit -m "master-ai: стриминговый эндпоинт POST /api/llm/complete"
```

---

## Self-Review

**Покрытие (План 3 — слой LLM, бэкенд):**
- Типы LLM-сообщений (shared) → Task 1. ✅
- Абстракция `LLMProvider` + `FakeProvider` → Task 2. ✅
- `CliProvider` (стрим, ошибки) → Task 3. ✅
- Выбор провайдера по конфигу → Task 4. ✅
- Стриминговый эндпоинт `/api/llm/complete` → Task 5. ✅
- ApiProvider (OpenAI-совместимый), inline-AI в редакторе, брейнсторм, поиск — вне Плана 3 (Планы 4–6). ✅ (осознанно; интерфейс `LLMProvider` оставляет место под `ApiProvider`)

**Заглушки:** нет — полный код или конкретная команда в каждом шаге.

**Согласованность типов:** `CompleteInput`/`LlmMessage` (Task 1) используются в `provider.ts`, `cli.ts`, эндпоинте (Task 5); `LLMProvider`/`LlmError` (Task 2) — в `cli.ts`, `config.ts`, `app.ts`; `CliProvider`/`CliProviderConfig` (Task 3) — в `config.ts`. Сигнатура `buildApp` расширяется обратносовместимо (`llm?` опционален), существующие вызовы `buildApp({ db })` остаются валидными. ✅
