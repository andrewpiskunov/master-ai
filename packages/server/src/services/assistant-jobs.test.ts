import { describe, it, expect } from "vitest";
import { AssistantJobService } from "./assistant-jobs.js";

const tick = () => new Promise((r) => setTimeout(r, 10));

// Управляемый поток: чанки отдаются вручную.
function manualStream() {
  const queue: string[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  const push = (s: string) => { queue.push(s); wake?.(); };
  const finish = () => { done = true; wake?.(); };
  const stream = (async function* () {
    for (;;) {
      while (queue.length) yield queue.shift()!;
      if (done) return;
      await new Promise<void>((r) => { wake = r; });
    }
  })();
  return { stream, push, finish };
}

describe("AssistantJobService", () => {
  it("копит partial по мере генерации и сохраняет ответ по завершении", async () => {
    const svc = new AssistantJobService();
    const { stream, push, finish } = manualStream();
    let saved = "";
    expect(svc.start("d1", stream, (t) => { saved = t; })).toBe(true);

    push("Привет");
    await tick();
    expect(svc.status("d1")).toMatchObject({ running: true, partial: "Привет" });

    push(", мастер!");
    finish();
    await tick();
    expect(svc.status("d1")).toMatchObject({ running: false, partial: "Привет, мастер!" });
    expect(saved).toBe("Привет, мастер!");
  });

  it("вторая задача по тому же документу не стартует, пока идёт первая", async () => {
    const svc = new AssistantJobService();
    const a = manualStream();
    expect(svc.start("d1", a.stream, () => {})).toBe(true);
    expect(svc.start("d1", manualStream().stream, () => {})).toBe(false);
    a.finish();
    await tick();
    expect(svc.start("d1", manualStream().stream, () => {})).toBe(true);
  });

  it("stop завершает задачу и сохраняет накопленный текст", async () => {
    const svc = new AssistantJobService();
    const { stream, push } = manualStream();
    let saved = "";
    svc.start("d1", stream, (t) => { saved = t; });
    push("Начало");
    await tick();
    expect(svc.stop("d1")).toBe(true);
    push("…ещё"); // после stop цикл прервётся на следующем чанке
    await tick();
    expect(svc.status("d1").running).toBe(false);
    expect(saved.startsWith("Начало")).toBe(true);
  });

  it("ошибка потока попадает в статус, пустой ответ не сохраняется", async () => {
    const svc = new AssistantJobService();
    const bad = (async function* (): AsyncIterable<string> { throw new Error("сбой LLM"); })();
    let savedCalls = 0;
    svc.start("d1", bad, () => { savedCalls++; });
    await tick();
    expect(svc.status("d1")).toMatchObject({ running: false, error: "сбой LLM" });
    expect(savedCalls).toBe(0);
  });

  it("stop без задачи → false", () => {
    expect(new AssistantJobService().stop("нет")).toBe(false);
  });
});
