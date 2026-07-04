import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { UsageService } from "./usage.js";

function makeSvc() {
  const { db } = createDb(":memory:");
  return new UsageService(db);
}

describe("UsageService", () => {
  it("копит расход по кампании: агрегация по фичам, моделям и среднему времени", () => {
    const svc = makeSvc();
    svc.record("c1", "workshop", { promptTokens: 100, completionTokens: 50, estimated: false, provider: "openai", model: "gpt-4o-mini", durationMs: 1000 });
    svc.record("c1", "workshop", { promptTokens: 200, completionTokens: 80, estimated: false, provider: "openai", model: "gpt-4o-mini", durationMs: 3000 });
    svc.record("c1", "game", { promptTokens: 10, completionTokens: 5, estimated: true, provider: "cli", model: "claude", durationMs: 500 });
    svc.record("c2", "workshop", { promptTokens: 999, completionTokens: 999, estimated: false });

    const stats = svc.statsByCampaign("c1");
    expect(stats.total).toEqual({ promptTokens: 310, completionTokens: 135, requests: 3, estimated: true, avgDurationMs: 1500 });
    // сортировка по суммарному расходу: workshop первым
    expect(stats.byFeature).toEqual([
      { feature: "workshop", promptTokens: 300, completionTokens: 130, requests: 2, estimated: false, avgDurationMs: 2000 },
      { feature: "game", promptTokens: 10, completionTokens: 5, requests: 1, estimated: true, avgDurationMs: 500 },
    ]);
    expect(stats.byModel).toEqual([
      { provider: "openai", model: "gpt-4o-mini", promptTokens: 300, completionTokens: 130, requests: 2, avgDurationMs: 2000 },
      { provider: "cli", model: "claude", promptTokens: 10, completionTokens: 5, requests: 1, avgDurationMs: 500 },
    ]);
  });

  it("глобальная статистика: все кампании + разбивка по ним, удалённые не теряются", () => {
    const svc = makeSvc();
    svc.record("c1", "workshop", { promptTokens: 100, completionTokens: 50, estimated: false, provider: "openai", model: "gpt-4o-mini", durationMs: 1000 });
    svc.record("c2", "game", { promptTokens: 30, completionTokens: 20, estimated: true, provider: "cli", model: "claude", durationMs: 2000 });

    const names: Record<string, string> = { c1: "Корона" }; // c2 «удалена»
    const stats = svc.statsGlobal((id) => names[id]);
    expect(stats.total).toEqual({ promptTokens: 130, completionTokens: 70, requests: 2, estimated: true, avgDurationMs: 1500 });
    expect(stats.byCampaign).toEqual([
      { campaignId: "c1", name: "Корона", promptTokens: 100, completionTokens: 50, requests: 1, estimated: false, avgDurationMs: 1000 },
      { campaignId: "c2", name: "(удалённая кампания)", promptTokens: 30, completionTokens: 20, requests: 1, estimated: true, avgDurationMs: 2000 },
    ]);
    expect(stats.byModel).toHaveLength(2);
  });

  it("пустая кампания — нулевая статистика; запись без длительности не ломает среднее", () => {
    const svc = makeSvc();
    expect(svc.statsByCampaign("нет")).toEqual({
      total: { promptTokens: 0, completionTokens: 0, requests: 0, estimated: false, avgDurationMs: 0 },
      byFeature: [],
      byModel: [],
    });

    svc.record("c1", "world", { promptTokens: 10, completionTokens: 10, estimated: true }); // без durationMs и модели
    svc.record("c1", "world", { promptTokens: 10, completionTokens: 10, estimated: true, provider: "cli", model: "claude", durationMs: 400 });
    const stats = svc.statsByCampaign("c1");
    // среднее — только по запросам с замером
    expect(stats.total.avgDurationMs).toBe(400);
  });
});
