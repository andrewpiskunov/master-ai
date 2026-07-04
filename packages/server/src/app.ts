import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Readable } from "node:stream";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import {
  NewCampaignSchema,
  CampaignPatchSchema,
  NewDocumentSchema,
  DOCUMENT_TYPES,
  getDocumentType,
  CompleteInputSchema,
  NewLinkSchema,
  extractLogBlock,
  fallbackLogTitle,
  stripChoicePrompts,
  stripLogFence,
  type LlmUsage,
  type MessageMeta,
} from "@master-ai/shared";
import { z } from "zod";
import { CampaignService } from "./services/campaigns.js";
import { DocumentService } from "./services/documents.js";
import { ConversationService } from "./services/conversations.js";
import { ProposalService } from "./services/proposals.js";
import { textToDoc } from "./services/proposals.js";
import { BrainstormService } from "./services/brainstorm.js";
import { LinkService } from "./services/links.js";
import { SearchService } from "./services/search.js";
import { AssistantJobService } from "./services/assistant-jobs.js";
import { UsageService } from "./services/usage.js";
import { TransferService } from "./services/transfer.js";
import type { LLMProvider } from "./llm/provider.js";
import { loadProvider } from "./llm/config.js";
import { providerForCampaign } from "./llm/resolve.js";

type IdParams = { Params: { id: string } };

function buildWelcome(name: string): string {
  return [
    `Привет! Я — ваш ассистент-соавтор. Помогу собрать кампанию «${name}» и подготовить её к игре за столом.`,
    "",
    "Расскажите, что у вас уже есть в голове:",
    "- о каком приключении вы думаете, в каком сеттинге и системе;",
    "- кто герои и в какую историю они попадают в начале;",
    "- или, может, уже есть конкретный злодей, место или завязка.",
    "",
    "Можно начать с любой детали — я задам уточняющие вопросы и предложу первые документы (NPC, локации, секреты, сцены).",
  ].join("\n");
}

// Приветствие подбирается ИИ под название кампании; при сбое — статичный текст.
async function generateWelcome(llm: LLMProvider, name: string, onUsage?: (u: LlmUsage) => void): Promise<string> {
  try {
    let out = "";
    for await (const chunk of llm.complete({
      system:
        "Ты — ассистент-соавтор мастера настольных ролевых игр. Напиши короткое тёплое приветствие по-русски (2–3 абзаца, без списков и заголовков) для НОВОЙ кампании. " +
        `1) Поздоровайся и скажи, что поможешь подготовить кампанию «${name}» к первой игре; цель — не расписывать тонны лора, а уверенно вести сессии за столом. ` +
        "2) Сделай короткую догадку о сеттинге, теме или тоне ИМЕННО по названию кампании. " +
        "3) Задай 1–2 открытых вопроса: как мастер видит игру на практике, кем будут герои и какая завязка столкнёт их на первой сессии. " +
        "Пиши живо и по делу, обращайся на «вы».",
      messages: [{ role: "user", content: `Название кампании: «${name}». Напиши приветствие.` }],
    }, { onUsage })) {
      out += chunk;
    }
    return out.trim() || buildWelcome(name);
  } catch {
    return buildWelcome(name);
  }
}

const DocumentPatchSchema = z.object({
  type: z.string().optional(),
  title: z.string().min(1).optional(),
  status: z.string().nullable().optional(),
  contentJson: z.unknown().optional(),
  fields: z.record(z.unknown()).optional(),
});

export function buildApp(deps: { db: BetterSQLite3Database; llm?: LLMProvider; sqlite?: SqliteDatabase }): FastifyInstance {
  const app = Fastify();
  app.register(cors, { origin: true });

  const llm = deps.llm ?? loadProvider();
  const campaignsSvc = new CampaignService(deps.db);
  // Нейросеть выбирается настройками кампании; без кампании — провайдер по умолчанию.
  const llmFor = (campaignId?: string | null): LLMProvider =>
    providerForCampaign(campaignId ? campaignsSvc.get(campaignId) : undefined, llm);
  const documentsSvc = new DocumentService(deps.db);
  const conversationsSvc = new ConversationService(deps.db);
  const proposalsSvc = new ProposalService(deps.db);
  const usageSvc = new UsageService(deps.db);
  // Колбэк учёта токенов; кампании без id (нет контекста) не учитываем.
  const trackUsage = (campaignId: string | null | undefined, feature: string) => ({
    onUsage: (u: LlmUsage) => { if (campaignId) usageSvc.record(campaignId, feature, u); },
  });
  const brainstormSvc = new BrainstormService({ llmFor, conversations: conversationsSvc, proposals: proposalsSvc, documents: documentsSvc, campaigns: campaignsSvc, usage: usageSvc });
  const linksSvc = new LinkService(deps.db);
  const searchSvc = new SearchService(deps.db);
  const BrainstormBodySchema = z.object({ message: z.string().min(1) });
  const NewMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) });
  const assistantJobs = new AssistantJobService();
  const workshopJobs = new AssistantJobService(); // фоновые генерации мастерской (ключ — id кампании)
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

  app.get("/api/document-types", () => DOCUMENT_TYPES);

  // Резервная копия базы одним файлом — «скачать бэкап» из управления кампанией.
  app.get("/api/backup", (_req, reply) => {
    if (!deps.sqlite) return reply.code(503).send({ error: "Бэкап недоступен" });
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-disposition", `attachment; filename="master-ai-${stamp}.sqlite"`)
      .type("application/octet-stream")
      .send(deps.sqlite.serialize());
  });

  app.get("/api/campaigns", () => campaignsSvc.list());

  app.post("/api/campaigns", (req, reply) => {
    const parsed = NewCampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const campaign = campaignsSvc.create(parsed.data);
    // Приветствие ИИ генерируем в фоне и НЕ блокируем создание: клиент сразу
    // попадает в кампанию, а приветствие «допечатывается» в беседе, когда готово.
    const conv = conversationsSvc.getOrCreateForCampaign(campaign.id);
    void generateWelcome(llmFor(campaign.id), campaign.name, trackUsage(campaign.id, "welcome").onUsage)
      // Пока генерировалось приветствие, кампанию могли удалить — не создаём «висячее» сообщение.
      .then((text) => { if (campaignsSvc.get(campaign.id)) conversationsSvc.addMessage(conv.id, "assistant", text); })
      .catch(() => { /* приветствие не критично для создания кампании */ });
    return reply.code(201).send(campaign);
  });

  app.delete<IdParams>("/api/campaigns/:id", (req, reply) => {
    const { id } = req.params;
    if (!campaignsSvc.delete(id)) return reply.code(404).send({ error: "кампания не найдена" });
    return reply.code(204).send();
  });

  app.get<IdParams>("/api/campaigns/:id", (req, reply) => {
    const { id } = req.params;
    const campaign = campaignsSvc.get(id);
    if (!campaign) return reply.code(404).send({ error: "not found" });
    return campaign;
  });

  app.patch<IdParams>("/api/campaigns/:id", (req, reply) => {
    const { id } = req.params;
    const parsed = CampaignPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updated = campaignsSvc.update(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "кампания не найдена" });
    return updated;
  });

  app.get<IdParams>("/api/campaigns/:id/documents", (req) => {
    const { id } = req.params;
    return documentsSvc.listByCampaign(id);
  });

  app.post("/api/documents", (req, reply) => {
    const parsed = NewDocumentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const typeDef = getDocumentType(parsed.data.type);
    if (!typeDef) return reply.code(400).send({ error: `unknown document type: ${parsed.data.type}` });

    const status = parsed.data.status;
    if (status != null && !typeDef.statuses.includes(status)) {
      return reply.code(400).send({ error: `invalid status "${status}" for type "${parsed.data.type}"` });
    }

    const campaign = campaignsSvc.get(parsed.data.campaignId);
    if (!campaign) return reply.code(404).send({ error: "campaign not found" });

    return reply.code(201).send(documentsSvc.create(parsed.data));
  });

  app.get<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    return doc;
  });

  app.delete<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    if (!documentsSvc.delete(id)) return reply.code(404).send({ error: "документ не найден" });
    return reply.code(204).send();
  });

  app.patch<IdParams>("/api/documents/:id", (req, reply) => {
    const { id } = req.params;
    const parsed = DocumentPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const existing = documentsSvc.get(id);
    if (!existing) return reply.code(404).send({ error: "not found" });

    // Новый тип (если меняется) должен быть известным.
    if (parsed.data.type != null && !getDocumentType(parsed.data.type)) {
      return reply.code(400).send({ error: `unknown document type: ${parsed.data.type}` });
    }
    const effectiveType = parsed.data.type ?? existing.type;
    const typeDef = getDocumentType(effectiveType);

    const patch = { ...parsed.data };
    if (patch.status != null) {
      if (typeDef && !typeDef.statuses.includes(patch.status)) {
        return reply.code(400).send({ error: `invalid status "${patch.status}" for type "${effectiveType}"` });
      }
    } else if (parsed.data.type != null && existing.status != null && typeDef && !typeDef.statuses.includes(existing.status)) {
      // Тип сменился, а прежний статус не подходит новому типу — сбрасываем.
      patch.status = null;
    }

    const updated = documentsSvc.update(id, patch);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

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

  app.post("/api/campaigns/:id/brainstorm", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = BrainstormBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return brainstormSvc.respond(id, parsed.data.message);
  });

  // Генерация мастерской фоновой задачей на сервере (как у помощника документа):
  // навигация и закрытие вкладки её не прерывают, клиент опрашивает статус.
  app.post("/api/campaigns/:id/brainstorm/start", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = BrainstormBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    if (!campaignsSvc.get(id)) return reply.code(404).send({ error: "кампания не найдена" });
    if (workshopJobs.status(id).running) return reply.code(409).send({ error: "Генерация мастерской уже идёт" });
    const abort = new AbortController();
    const { conversationId, stream } = brainstormSvc.prepareRespond(id, parsed.data.message, abort.signal);
    workshopJobs.start(id, stream, (full) => {
      // Пока шла генерация, кампанию могли удалить — не создаём «висячие» записи.
      if (campaignsSvc.get(id)) brainstormSvc.finishRespond(id, conversationId, full);
    }, abort);
    return reply.code(202).send({ started: true });
  });

  app.get("/api/campaigns/:id/brainstorm/status", (req) => workshopJobs.status((req.params as { id: string }).id));

  // Остановка генерации мастерской: сигнал обрывает CLI/HTTP, набранный текст сохраняется.
  app.post("/api/campaigns/:id/brainstorm/stop", (req, reply) => {
    if (!workshopJobs.stop((req.params as { id: string }).id)) return reply.code(404).send({ error: "генерация не идёт" });
    return reply.code(204).send();
  });

  app.get("/api/campaigns/:id/world", async (req) => {
    const { id } = req.params as { id: string };
    return brainstormSvc.worldSummary(id);
  });

  app.get("/api/campaigns/:id/consistency", async (req) => {
    const { id } = req.params as { id: string };
    return brainstormSvc.checkConsistency(id);
  });

  // Завершить сессию и создать следующую: сводка ИИ → новая сессия с заполненным
  // «Что было в прошлый раз» и заделом на планируемые моменты.
  app.post<IdParams>("/api/documents/:id/next-session", async (req, reply) => {
    const { id } = req.params;
    const sess = documentsSvc.get(id);
    if (!sess) return reply.code(404).send({ error: "документ не найден" });
    if (sess.type !== "session") return reply.code(400).send({ error: "документ не является сессией" });

    // Идемпотентность: если следующая сессия уже создана — вернуть её.
    const existingNext = typeof sess.fields?.nextSessionId === "string" ? sess.fields.nextSessionId : null;
    if (existingNext) {
      const existing = documentsSvc.get(existingNext);
      if (existing) return existing;
    }

    const { summary, seed } = await brainstormSvc.sessionSummary(id);
    // Номер следующей сессии — максимум по всем сессиям кампании: поле sessionNumber,
    // а для сессий без него (созданных ИИ/вручную) — число из названия «Сессия N…».
    const sessionNum = (d: { title: string; fields?: Record<string, unknown> }): number => {
      if (typeof d.fields?.sessionNumber === "number") return d.fields.sessionNumber;
      const m = /^сессия\s+(\d+)/i.exec(d.title.trim());
      return m ? Number(m[1]) : 0;
    };
    const sessions = documentsSvc.listByCampaign(sess.campaignId).filter((d) => d.type === "session");
    // Сессии без номера (авторские названия вроде «Испытание Шпигельгрунда») дают 0 —
    // страхуемся количеством сессий, чтобы следующая после такой не стала «Сессией 1».
    const nextNum = Math.max(sessions.length, ...sessions.map(sessionNum)) + 1;
    const md = [
      "## Цель сессии", "",
      "## Что было в прошлый раз", summary || "",
      "## Запланированные моменты", seed || "",
      "## NPC и локации", "",
      "## Заметки и что доделать", "",
    ].join("\n");

    const created = documentsSvc.create({
      campaignId: sess.campaignId,
      type: "session",
      title: `Сессия ${nextNum}`,
      contentJson: textToDoc(md),
      fields: { sessionNumber: nextNum, prevSessionId: id },
    });
    // Помечаем текущую сыгранной, сохраняем сводку и связь на следующую.
    documentsSvc.update(id, { status: "played", fields: { ...sess.fields, summary, nextSessionId: created.id } });
    return reply.code(201).send(created);
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

  app.get<IdParams>("/api/documents/:id/conversation", (req, reply) => {
    const { id } = req.params;
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    return conversationsSvc.listMessages(conv.id);
  });

  // Генерация помощника документа выполняется на сервере фоновой задачей —
  // навигация или закрытие вкладки её не прерывают. Клиент опрашивает статус.
  app.post<IdParams>("/api/documents/:id/assistant", (req, reply) => {
    const { id } = req.params;
    const parsed = AssistantStartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    if (assistantJobs.status(id).running) return reply.code(409).send({ error: "Генерация по этому документу уже идёт" });

    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    conversationsSvc.addMessage(conv.id, "user", parsed.data.message, parsed.data.meta);
    // В LLM уходит только хвост беседы — полная история упирается в контекст модели.
    // Действия игрового чата префиксуются актором, чтобы ИИ видел, кто действует.
    // Ответы ИИ в игровом режиме уходят в историю без служебных log-блоков —
    // иначе модель имитирует паттерн «текст после log-блока» из своих прошлых ответов.
    const history = conversationsSvc.listMessages(conv.id).slice(-20).map((m) => ({
      role: m.role,
      content:
        m.role === "user" && m.meta?.actorName && m.meta.actorKind && m.meta.actorKind !== "master"
          ? `Действие (${m.meta.actorName}): ${m.content}`
          : m.role === "assistant" && parsed.data.mode === "game"
            ? stripChoicePrompts(stripLogFence(m.content))
            : m.content,
    }));
    // Контроллер остановки: stop() обрывает генерацию у провайдера (CLI/HTTP) сразу.
    const abort = new AbortController();
    const stream = llmFor(doc.campaignId).complete(
      { system: parsed.data.system, messages: history },
      { ...trackUsage(doc.campaignId, parsed.data.mode === "game" ? "game" : "assistant"), signal: abort.signal },
    );
    // Действие персонажа всегда порождает запись лога: из log-блока ответа,
    // а если ИИ его не вернул — с заголовком из первых слов действия.
    const isAction = parsed.data.mode === "game" && !!parsed.data.meta?.actorKind && parsed.data.meta.actorKind !== "master";
    const actionText = parsed.data.message;
    assistantJobs.start(id, stream, (text) => {
      // Пока шла генерация, документ могли удалить — не создаём «висячий» ответ.
      if (documentsSvc.get(id)) {
        let meta: MessageMeta | undefined;
        if (isAction) {
          const { log } = extractLogBlock(text);
          meta = { log: log ?? { title: fallbackLogTitle(actionText), important: false } };
        }
        conversationsSvc.addMessage(conv.id, "assistant", text, meta);
      }
    }, abort);
    return reply.code(202).send({ started: true });
  });

  app.get<IdParams>("/api/documents/:id/assistant", (req) => assistantJobs.status(req.params.id));

  app.post<IdParams>("/api/documents/:id/assistant/stop", (req, reply) => {
    if (!assistantJobs.stop(req.params.id)) return reply.code(404).send({ error: "генерация не идёт" });
    return reply.code(204).send();
  });

  // Очистка беседы ассистента документа («Очистить беседу» в помощнике).
  app.delete<IdParams>("/api/documents/:id/conversation", (req, reply) => {
    const { id } = req.params;
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    conversationsSvc.clearForDocument(id);
    return reply.code(204).send();
  });

  app.post<IdParams>("/api/documents/:id/conversation/messages", (req, reply) => {
    const { id } = req.params;
    const parsed = NewMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const doc = documentsSvc.get(id);
    if (!doc) return reply.code(404).send({ error: "документ не найден" });
    const conv = conversationsSvc.getOrCreateForDocument(doc.campaignId, id);
    return reply.code(201).send(conversationsSvc.addMessage(conv.id, parsed.data.role, parsed.data.content));
  });

  // Точечное обновление меты сообщения — переключение важности записи лога в режиме игры.
  app.patch("/api/messages/:id/meta", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = MessageMetaPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updated = conversationsSvc.updateMessageMeta(id, parsed.data);
    if (!updated) return reply.code(404).send({ error: "сообщение не найдено" });
    return updated;
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

  app.post("/api/llm/complete", (req, reply) => {
    const parsed = CompleteInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    reply.type("text/plain; charset=utf-8");
    return Readable.from(llmFor(parsed.data.campaignId).complete(parsed.data, trackUsage(parsed.data.campaignId, "tools")));
  });

  app.get("/api/campaigns/:id/llm-usage", (req) => {
    const { id } = req.params as { id: string };
    return usageSvc.statsByCampaign(id);
  });

  // Итоговая статистика расхода по всему сайту (все кампании).
  app.get("/api/llm-usage", () => usageSvc.statsGlobal((id) => campaignsSvc.get(id)?.name));

  const transferSvc = new TransferService(deps.db);

  // Полный экспорт кампании одним JSON-файлом (документы, беседы, предложения, связи, статистика).
  app.get("/api/campaigns/:id/export-json", (req, reply) => {
    const { id } = req.params as { id: string };
    const data = transferSvc.export(id);
    if (!data) return reply.code(404).send({ error: "кампания не найдена" });
    const slug = data.campaign.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "campaign";
    reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${slug}.master-ai.json`)}`);
    reply.type("application/json; charset=utf-8");
    return reply.send(JSON.stringify(data, null, 2));
  });

  // Импорт кампании из такого же JSON — создаёт НОВУЮ кампанию, id перевязываются.
  app.post("/api/campaigns/import-json", { bodyLimit: 64 * 1024 * 1024 }, (req, reply) => {
    try {
      const created = transferSvc.import(req.body);
      return reply.code(201).send(created);
    } catch {
      return reply.code(400).send({ error: "Файл не похож на экспорт кампании MasterAI (master-ai-campaign, версия 1)" });
    }
  });

  return app;
}
