# master-ai — План 4: Inline-AI в редакторе

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В редакторе документа AI по запросу стримит предложение прямо в текст (inline, в отличимом стиле), которое можно принять или отклонить; ошибки показываются тостами.

**Architecture:** Фронтенд получает стрим из эндпоинта Плана 3 (`POST /api/llm/complete`) через `streamComplete`. Предложение реализовано НЕ декорациями, а кастомным TipTap-mark `suggestion`: стримящийся текст вставляется в документ с этой меткой (отличимый стиль), на время стрима редактор переводится в read-only для стабильности позиций. **Принять** — снять метку с диапазона (текст остаётся обычным); **Отклонить** — удалить диапазон. Ошибки (в т.ч. сетевые) — через общий `useToast`.

**Tech Stack:** Fetch streaming (ReadableStream + TextDecoder), TipTap Mark API, React context, Vitest + Testing Library.

## Global Constraints

- Node 20+, pnpm. TypeScript ESM ("module":"NodeNext") — относительные импорты с `.js`; типы из `@master-ai/shared`.
- Тесты — Vitest (+ jsdom для компонентов). `pnpm -r typecheck` (tsc --noEmit) должен проходить.
- Каждый таск завершается зелёными тестами + коммит. Коммиты — только имя автора, без Co-Authored-By/AI-трейлеров.
- Эндпоинт `POST /api/llm/complete` (План 3) принимает `{ system?, messages: {role,content}[] }` (непустой messages) и СТРИМИТ текст. Важно: ошибка ПОСЛЕ первого чанка приходит как обрыв тела при статусе 200 — для текущего плана это допустимо (показываем то, что успело прийти); ошибка ДО первого чанка → не-200 → тост.
- Рабочая директория: `Docs/НРИ/master-ai/`.

---

### Task 1: Стриминг-клиент streamComplete

**Files:**
- Create: `packages/web/src/api/stream.ts`
- Test: `packages/web/src/api/stream.test.ts`

**Interfaces:**
- Consumes: `CompleteInput` (shared), `ApiError` (`./client.js`).
- Produces: `streamComplete(input: CompleteInput, onChunk: (text: string) => void): Promise<string>` — POST на `/api/llm/complete`, читает тело как поток, декодирует UTF-8 пер-чанк (через `TextDecoder({stream:true})`), зовёт `onChunk` на каждый кусок и возвращает полный текст. При не-2xx или отсутствии тела — бросает `ApiError`.

- [ ] **Step 1: Падающий тест (мок fetch со стримом)**

`packages/web/src/api/stream.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { streamComplete } from "./stream.js";
import { ApiError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status });
}

const input = { messages: [{ role: "user" as const, content: "привет" }] };

describe("streamComplete", () => {
  it("зовёт onChunk и возвращает полный текст", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(["Привет", ", ", "мир"])));
    const chunks: string[] = [];
    const full = await streamComplete(input, (c) => chunks.push(c));
    expect(full).toBe("Привет, мир");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("бросает ApiError при не-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    await expect(streamComplete(input, () => {})).rejects.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/web test stream`
Expected: FAIL — `./stream.js` не найден.

- [ ] **Step 3: Реализовать**

`packages/web/src/api/stream.ts`:
```ts
import type { CompleteInput } from "@master-ai/shared";
import { ApiError } from "./client.js";

export async function streamComplete(
  input: CompleteInput,
  onChunk: (text: string) => void,
): Promise<string> {
  const res = await fetch("/api/llm/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `Ошибка LLM (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) {
      full += text;
      onChunk(text);
    }
  }
  const tail = decoder.decode();
  if (tail) {
    full += tail;
    onChunk(tail);
  }
  return full;
}
```

- [ ] **Step 4: Тест зелёный + typecheck**

Run: `pnpm --filter @master-ai/web test stream && pnpm --filter @master-ai/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/stream.ts packages/web/src/api/stream.test.ts
git commit -m "master-ai: стриминг-клиент streamComplete"
```

---

### Task 2: Инфраструктура тостов

**Files:**
- Create: `packages/web/src/ui/toast.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/ui/toast.test.tsx`

**Interfaces:**
- Produces:
  - `ToastProvider({ children })` — провайдер контекста; рендерит детей и контейнер тостов (`role="status"`).
  - `useToast(): { showToast: (message: string) => void }` — бросает, если вне провайдера.
- В `App` всё дерево роутов оборачивается в `ToastProvider`.

- [ ] **Step 1: Падающий тест**

`packages/web/src/ui/toast.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { ToastProvider, useToast } from "./toast.js";

function Trigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast("Что-то сломалось")}>бахнуть</button>;
}

describe("ToastProvider", () => {
  it("показывает тост по showToast", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "бахнуть" }));
    expect(await screen.findByText("Что-то сломалось")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/web test toast`
Expected: FAIL — `./toast.js` не найден.

- [ ] **Step 3: Реализовать**

`packages/web/src/ui/toast.tsx`:
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
}
interface ToastApi {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast должен использоваться внутри ToastProvider");
  return ctx;
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div role="status" aria-live="polite" className="toaster">
        {toasts.map((t) => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 4: Обернуть App в ToastProvider**

В `packages/web/src/App.tsx` импортировать `ToastProvider` (`./ui/toast.js`) и обернуть `<BrowserRouter>…</BrowserRouter>` в `<ToastProvider>…</ToastProvider>`. Существующий тест App (мокает api client) должен продолжать проходить.

- [ ] **Step 5: Тесты зелёные + typecheck**

Run: `pnpm --filter @master-ai/web test && pnpm --filter @master-ai/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/ui packages/web/src/App.tsx
git commit -m "master-ai: инфраструктура тостов (ToastProvider/useToast)"
```

---

### Task 3: TipTap-mark «suggestion»

**Files:**
- Create: `packages/web/src/editor/SuggestionMark.ts`
- Test: `packages/web/src/editor/SuggestionMark.test.ts`

**Interfaces:**
- Produces: `SuggestionMark` — TipTap `Mark` с именем `"suggestion"`, рендерится как `<span data-suggestion="true" class="ai-suggestion">`, парсится с такого span.

- [ ] **Step 1: Падающий тест (через инстанс редактора)**

`packages/web/src/editor/SuggestionMark.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SuggestionMark } from "./SuggestionMark.js";

describe("SuggestionMark", () => {
  it("рендерит текст с маркой как span.ai-suggestion", () => {
    const editor = new Editor({
      extensions: [StarterKit, SuggestionMark],
      content: "<p></p>",
    });
    editor.commands.insertContent({
      type: "text",
      text: "идея",
      marks: [{ type: "suggestion" }],
    });
    expect(editor.getHTML()).toContain("ai-suggestion");
    editor.destroy();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/web test SuggestionMark`
Expected: FAIL — `./SuggestionMark.js` не найден.

- [ ] **Step 3: Реализовать**

`packages/web/src/editor/SuggestionMark.ts`:
```ts
import { Mark, mergeAttributes } from "@tiptap/core";

export const SuggestionMark = Mark.create({
  name: "suggestion",

  parseHTML() {
    return [{ tag: "span[data-suggestion]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-suggestion": "true", class: "ai-suggestion" }),
      0,
    ];
  },
});
```

- [ ] **Step 4: Тест зелёный + typecheck**

Run: `pnpm --filter @master-ai/web test SuggestionMark && pnpm --filter @master-ai/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/editor/SuggestionMark.ts packages/web/src/editor/SuggestionMark.test.ts
git commit -m "master-ai: TipTap-mark suggestion для inline-AI"
```

---

### Task 4: Inline-AI в DocumentEditor (стрим + accept/reject)

**Files:**
- Modify: `packages/web/src/editor/DocumentEditor.tsx`
- Test: `packages/web/src/editor/DocumentEditor.test.tsx`

**Interfaces:**
- Consumes: `streamComplete` (Task 1), `useToast` (Task 2), `SuggestionMark` (Task 3), `@tiptap/react`, `@tiptap/starter-kit`.
- Produces: `DocumentEditor` (та же сигнатура `{ content, onChange }`) с добавленным AI:
  - Кнопка «✨ Продолжить»: собирает контекст (текст документа), зовёт `streamComplete`, вставляет приходящие чанки в документ с маркой `suggestion`, начиная с текущей позиции курсора; на время стрима редактор read-only.
  - После стрима показываются кнопки «Принять» и «Отклонить». Принять — снять марку с диапазона (текст остаётся), вернуть редактор в edit, дернуть `onChange`. Отклонить — удалить диапазон, вернуть в edit.
  - Ошибка `streamComplete` → `showToast`, редактор возвращается в edit, частично вставленный текст (если был) удаляется.

- [ ] **Step 1: Падающий тест (мок streamComplete и useToast)**

`packages/web/src/editor/DocumentEditor.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentEditor } from "./DocumentEditor.js";
import { streamComplete } from "../api/stream.js";

vi.mock("../api/stream.js");
vi.mock("../ui/toast.js", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

beforeEach(() => vi.resetAllMocks());

describe("DocumentEditor inline-AI", () => {
  it("стримит предложение и принимает его", async () => {
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("Барон ");
      onChunk("мрачен.");
      return "Барон мрачен.";
    });
    const onChange = vi.fn();
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /продолжить/i }));
    await waitFor(() => expect(streamComplete).toHaveBeenCalled());
    // предложение вставлено в документ
    expect(await screen.findByText(/Барон мрачен\./)).toBeInTheDocument();
    // принять
    await userEvent.click(screen.getByRole("button", { name: /принять/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // кнопки принять/отклонить исчезли
    expect(screen.queryByRole("button", { name: /принять/i })).not.toBeInTheDocument();
  });

  it("отклонение удаляет предложенный текст", async () => {
    vi.mocked(streamComplete).mockImplementation(async (_input, onChunk) => {
      onChunk("временный текст");
      return "временный текст";
    });
    render(<DocumentEditor content={{ type: "doc", content: [] }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /продолжить/i }));
    expect(await screen.findByText("временный текст")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /отклонить/i }));
    await waitFor(() =>
      expect(screen.queryByText("временный текст")).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/web test DocumentEditor`
Expected: FAIL — нет кнопки «Продолжить» / нового поведения.

- [ ] **Step 3: Реализовать DocumentEditor**

`packages/web/src/editor/DocumentEditor.tsx`:
```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { streamComplete } from "../api/stream.js";
import { useToast } from "../ui/toast.js";
import { SuggestionMark } from "./SuggestionMark.js";

interface DocumentEditorProps {
  content: unknown;
  onChange: (json: unknown) => void;
}

export function DocumentEditor({ content, onChange }: DocumentEditorProps) {
  const { showToast } = useToast();
  const [suggesting, setSuggesting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  // диапазон вставленного предложения в позициях ProseMirror
  const range = useRef<{ from: number; to: number }>({ from: 0, to: 0 });

  const editor = useEditor({
    extensions: [StarterKit, SuggestionMark],
    content: (content as object) ?? "",
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });

  async function requestSuggestion() {
    if (!editor) return;
    const docText = editor.getText();
    const from = editor.state.selection.to;
    range.current = { from, to: from };
    setStreaming(true);
    setSuggesting(true);
    editor.setEditable(false);
    try {
      await streamComplete(
        {
          system: "Ты — соавтор мастера настольных ролевых игр. Продолжи документ по-русски, кратко и по делу.",
          messages: [{ role: "user", content: `Текущий документ:\n${docText}\n\nПродолжи его.` }],
        },
        (chunk) => {
          const at = range.current.to;
          editor
            .chain()
            .insertContentAt(at, { type: "text", text: chunk, marks: [{ type: "suggestion" }] }, { updateSelection: false })
            .run();
          range.current = { from: range.current.from, to: at + chunk.length };
        },
      );
    } catch (err) {
      // убрать частично вставленное и сообщить
      const { from, to } = range.current;
      if (to > from) editor.chain().deleteRange({ from, to }).run();
      setSuggesting(false);
      editor.setEditable(true);
      showToast(err instanceof Error ? `Ошибка ИИ: ${err.message}` : "Ошибка ИИ");
    } finally {
      setStreaming(false);
    }
  }

  function acceptSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    editor.chain().setTextSelection({ from, to }).unsetMark("suggestion").setTextSelection(to).run();
    editor.setEditable(true);
    setSuggesting(false);
    onChange(editor.getJSON());
  }

  function rejectSuggestion() {
    if (!editor) return;
    const { from, to } = range.current;
    if (to > from) editor.chain().deleteRange({ from, to }).run();
    editor.setEditable(true);
    setSuggesting(false);
    onChange(editor.getJSON());
  }

  return (
    <div>
      <div className="editor-toolbar">
        {!suggesting && (
          <button type="button" onClick={requestSuggestion} disabled={streaming}>
            ✨ Продолжить
          </button>
        )}
        {suggesting && !streaming && (
          <>
            <button type="button" onClick={acceptSuggestion}>Принять</button>
            <button type="button" onClick={rejectSuggestion}>Отклонить</button>
          </>
        )}
        {streaming && <span>ИИ печатает…</span>}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
```

> Примечания:
> - На время стрима `editor.setEditable(false)` фиксирует позиции, поэтому слежение за `range.current.to` через `+ chunk.length` корректно (текст вставляется только нами).
> - Кнопки «Принять/Отклонить» появляются после завершения стрима (`suggesting && !streaming`).
> - `DocumentPage` уже рендерит `<DocumentEditor key={documentId} .../>` (План 2) — менять её не нужно; `DocumentEditor` теперь использует `useToast`, поэтому дерево должно быть внутри `ToastProvider` (обеспечено в Task 2 через App).

- [ ] **Step 4: Прогнать тест редактора + полный web-набор + typecheck**

Run: `pnpm --filter @master-ai/web test DocumentEditor && pnpm --filter @master-ai/web test && pnpm --filter @master-ai/web typecheck`
Expected: PASS. (TipTap в jsdom может писать безобидные предупреждения — тест проверяет вставку/принятие/отклонение.)

> Если тест на позиции/вставку нестабилен в jsdom: убедись, что начальный контент пустой документ (`{type:"doc",content:[]}`), и что `from` берётся как `editor.state.selection.to` ПОСЛЕ маунта. Не ослабляй тест; при необходимости отладь работу с позициями. BLOCKED только если действительно застрял.
>
> **ВАЖНО — обнови существующий тест `DocumentPage.test.tsx` (из Плана 2):** теперь `DocumentEditor` (который рендерит `DocumentPage`) вызывает `useToast`, поэтому без провайдера тест упадёт с «useToast должен использоваться внутри ToastProvider». Оберни рендеры в `DocumentPage.test.tsx` в `<ToastProvider>` (импорт из `../ui/toast.js`): например, в её `renderAt(id)` обернуть `<MemoryRouter…>` в `<ToastProvider>…</ToastProvider>`. Запусти `pnpm --filter @master-ai/web test DocumentPage` и убедись, что он зелёный, ПЕРЕД полным прогоном в этом шаге.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/editor/DocumentEditor.tsx packages/web/src/editor/DocumentEditor.test.tsx
git commit -m "master-ai: inline-AI в редакторе (стрим, принять/отклонить)"
```

---

### Task 5: Тосты ошибок на страницах + гигиена

**Files:**
- Modify: `packages/web/src/pages/HomePage.tsx`
- Modify: `packages/web/src/pages/CampaignPage.tsx`
- Modify: `packages/web/src/pages/DocumentPage.tsx`
- Modify: `packages/web/package.json`
- Test: `packages/web/src/pages/HomePage.test.tsx` (добавить кейс ошибки)

**Interfaces:**
- Consumes: `useToast` (Task 2).
- Produces: на каждой странице вызовы `api.*` обёрнуты так, что ошибка приводит к `showToast(...)` вместо тихого падения. В `HomePage` добавляется тест: `api.listCampaigns` реджектит → показывается тост.
- Гигиена: добавить `vitest` в `devDependencies` пакета web (был только в корне).

- [ ] **Step 1: Падающий тест ошибки на HomePage**

Добавить в `packages/web/src/pages/HomePage.test.tsx` (мок уже есть; страницы рендерятся внутри роутера — теперь обернуть в ToastProvider). Новый кейс:
```tsx
import { ToastProvider } from "../ui/toast.js";
// ... в renderPage оборачиваем:
//   render(<ToastProvider><MemoryRouter><HomePage/></MemoryRouter></ToastProvider>)

it("показывает тост при ошибке загрузки кампаний", async () => {
  vi.mocked(api.listCampaigns).mockRejectedValue(new Error("сеть упала"));
  renderPage();
  expect(await screen.findByText(/не удалось загрузить кампании/i)).toBeInTheDocument();
});
```
> Обнови `renderPage()` в этом файле, чтобы оборачивать в `<ToastProvider>`; существующие тесты должны продолжать проходить (они теперь тоже внутри провайдера).

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm --filter @master-ai/web test HomePage`
Expected: FAIL — тоста нет (ошибка глотается).

- [ ] **Step 3: Реализовать обработку ошибок**

В `HomePage.tsx`: получить `const { showToast } = useToast();`; загрузку и создание обернуть:
```tsx
useEffect(() => {
  api.listCampaigns().then(setCampaigns).catch(() => showToast("Не удалось загрузить кампании"));
}, [showToast]);
```
и в `handleSubmit` обернуть `createCampaign` в try/catch с `showToast("Не удалось создать кампанию")`.

В `CampaignPage.tsx`: аналогично обернуть `getCampaign`/`listCampaignDocuments`/`createDocument` (`.catch`/try-catch → `showToast("Не удалось загрузить кампанию")` / `"Не удалось создать документ"`).

В `DocumentPage.tsx`: обернуть `getDocument` (`.catch` → `showToast("Не удалось загрузить документ")`) и `save` (try/catch → `showToast("Не удалось сохранить")`).

> Используй осмысленные русские сообщения; конкретный текст для HomePage-загрузки должен содержать «не удалось загрузить кампании» (под тест). Не добавляй UI сверх тостов.
>
> **ВАЖНО — обнови тесты, которые рендерят страницы, использующие `useToast`:** `CampaignPage` теперь вызывает `useToast`, поэтому оберни рендеры в `CampaignPage.test.tsx` в `<ToastProvider>` (импорт из `../ui/toast.js`), иначе тест упадёт. (`DocumentPage.test.tsx` уже обёрнут в Task 4; `HomePage.test.tsx` обновляется в Step 1 этого таска.) После правок запусти `pnpm --filter @master-ai/web test` целиком — все файлы должны быть зелёными.

- [ ] **Step 4: Добавить vitest в devDependencies web**

В `packages/web/package.json` добавить в `devDependencies`:
```json
"vitest": "^2.1.0"
```
и `pnpm install`.

- [ ] **Step 5: Полный web-набор + typecheck**

Run: `pnpm --filter @master-ai/web test && pnpm --filter @master-ai/web typecheck`
Expected: PASS (включая новый кейс ошибки и существующие).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages packages/web/package.json pnpm-lock.yaml
git commit -m "master-ai: тосты ошибок на страницах + vitest в devDeps web"
```

---

### Task 6: Сквозная проверка inline-AI с реальным стримом

**Files:** (только проверка; правок кода не предполагается)

**Interfaces:** проверяет связку фронт↔бэк↔провайдер с подставной LLM-командой.

- [ ] **Step 1: Поднять стек с фейковой LLM-командой**

Подставная LLM: команда, которая печатает детерминированный русский текст (проверка UTF-8 пути). Запусти бэкенд с env:
```bash
MASTER_AI_LLM_CMD=node MASTER_AI_LLM_ARGS='-e console.log("Баронфон-Кройц мрачно смотрит на гостей.")' pnpm --filter @master-ai/server dev
```
(в отдельном процессе) и `pnpm --filter @master-ai/web dev`. Либо запусти оба и проверь через прокси.

- [ ] **Step 2: Проверить стрим эндпоинта через прокси**

Run:
```bash
curl -s -X POST http://localhost:5173/api/llm/complete -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"тест"}]}'
```
Expected: вернётся напечатанный командой русский текст без `�` (корректный UTF-8). Зафиксировать вывод в отчёте. Остановить серверы (не оставлять висеть).

- [ ] **Step 3: Полные гейты монорепо**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: PASS во всех пакетах (shared, server, web).

- [ ] **Step 4: Commit (если правок не было — пропустить)**

Если в ходе проверки правок не потребовалось — коммита нет; зафиксировать результат в отчёте.

---

## Self-Review

**Покрытие (План 4 — inline-AI, фронт):**
- Стриминг-клиент → Task 1. ✅
- Тосты → Task 2. ✅
- Mark `suggestion` → Task 3. ✅
- Inline-AI (стрим в документ, принять/отклонить, ошибки→тост) → Task 4. ✅
- Обработка ошибок страниц (follow-up Плана 2) + vitest в web → Task 5. ✅
- Сквозная проверка с реальным стримом → Task 6. ✅
- Брейнсторм/апрувы (План 5), поиск/линковка (План 6) — вне Плана 4. ✅

**Заглушки:** нет — полный код или конкретная команда в каждом шаге.

**Согласованность типов:** `streamComplete` (Task 1) принимает `CompleteInput` (shared) и используется в Task 4; `useToast` (Task 2) — в Task 4 и Task 5; `SuggestionMark` (Task 3) — в Task 4. `DocumentEditor` сохраняет сигнатуру `{content, onChange}` (План 2), поэтому `DocumentPage` менять не нужно. ✅
