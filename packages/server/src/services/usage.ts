import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { GlobalLlmUsageStats, LlmUsage, LlmUsageStats } from "@master-ai/shared";
import { llmUsage } from "../db/schema.js";

type UsageRow = typeof llmUsage.$inferSelect;

// Аккумулятор агрегации; средняя длительность — только по запросам, где она замерена.
function acc() {
  return { promptTokens: 0, completionTokens: 0, requests: 0, estimated: false, durTotal: 0, durCount: 0 };
}
type Acc = ReturnType<typeof acc>;
function add(a: Acc, r: UsageRow) {
  a.promptTokens += r.promptTokens;
  a.completionTokens += r.completionTokens;
  a.requests += 1;
  a.estimated ||= r.estimated === 1;
  if (r.durationMs != null) { a.durTotal += r.durationMs; a.durCount += 1; }
}
const avg = (a: Acc) => (a.durCount ? Math.round(a.durTotal / a.durCount) : 0);
const strip = ({ promptTokens, completionTokens, requests, estimated }: Acc) => ({ promptTokens, completionTokens, requests, estimated });

function aggregate(rows: UsageRow[]): LlmUsageStats {
  const total = acc();
  const byFeature = new Map<string, Acc>();
  const byModel = new Map<string, Acc & { provider: string; model: string }>();
  for (const r of rows) {
    add(total, r);
    const f = byFeature.get(r.feature) ?? acc();
    add(f, r);
    byFeature.set(r.feature, f);
    const key = `${r.provider ?? "?"}:${r.model ?? "?"}`;
    const m = byModel.get(key) ?? { ...acc(), provider: r.provider ?? "?", model: r.model ?? "?" };
    add(m, r);
    byModel.set(key, m);
  }
  return {
    total: { ...strip(total), avgDurationMs: avg(total) },
    byFeature: [...byFeature.entries()]
      .map(([feature, a]) => ({ feature, ...strip(a), avgDurationMs: avg(a) }))
      .sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)),
    byModel: [...byModel.values()]
      .map((a) => ({ provider: a.provider, model: a.model, promptTokens: a.promptTokens, completionTokens: a.completionTokens, requests: a.requests, avgDurationMs: avg(a) }))
      .sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)),
  };
}

// Учёт расхода запросов к нейросети: одна строка на запрос
// (токены, способ запроса, модель, время ответа).
export class UsageService {
  constructor(private db: BetterSQLite3Database) {}

  record(campaignId: string, feature: string, usage: LlmUsage): void {
    this.db.insert(llmUsage).values({
      id: randomUUID(),
      campaignId,
      feature,
      model: usage.model ?? null,
      promptTokens: Math.max(0, Math.round(usage.promptTokens)),
      completionTokens: Math.max(0, Math.round(usage.completionTokens)),
      estimated: usage.estimated ? 1 : 0,
      provider: usage.provider ?? null,
      durationMs: usage.durationMs != null ? Math.max(0, Math.round(usage.durationMs)) : null,
      createdAt: new Date().toISOString(),
    }).run();
  }

  statsByCampaign(campaignId: string): LlmUsageStats {
    return aggregate(this.db.select().from(llmUsage).where(eq(llmUsage.campaignId, campaignId)).all());
  }

  // Итог по всему сайту: общая агрегация + разбивка по кампаниям.
  // Названия кампаний подставляет вызывающий (удалённые кампании остаются в статистике).
  statsGlobal(campaignNames: (id: string) => string | undefined): GlobalLlmUsageStats {
    const rows = this.db.select().from(llmUsage).all();
    const byCampaign = new Map<string, Acc>();
    for (const r of rows) {
      const a = byCampaign.get(r.campaignId) ?? acc();
      add(a, r);
      byCampaign.set(r.campaignId, a);
    }
    return {
      ...aggregate(rows),
      byCampaign: [...byCampaign.entries()]
        .map(([campaignId, a]) => ({ campaignId, name: campaignNames(campaignId) ?? "(удалённая кампания)", ...strip(a), avgDurationMs: avg(a) }))
        .sort((a, b) => (b.promptTokens + b.completionTokens) - (a.promptTokens + a.completionTokens)),
    };
  }
}
