import { DOCUMENT_TEMPLATES, realismHint, type BrainstormResponse, type ConsistencyIssue, type ImageAttachment, type LlmMessage, type Proposal } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import { parseProposals } from "../llm/parse-proposals.js";
import { proseMirrorToText } from "./prosemirror-text.js";

// Разбор JSON-ответа с противоречиями (терпим к обрамлению текстом/фенсами).
function parseIssues(text: string): ConsistencyIssue[] {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fence ? fence[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { issues?: unknown[] };
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    return issues
      .filter((x): x is { documents: unknown[]; contradiction: string; fix?: string } =>
        !!x && typeof x === "object" && Array.isArray((x as { documents?: unknown }).documents) && typeof (x as { contradiction?: unknown }).contradiction === "string")
      .map((x) => ({ documents: x.documents.map(String), contradiction: String(x.contradiction), fix: String(x.fix ?? "") }));
  } catch {
    return [];
  }
}
import type { CampaignService } from "./campaigns.js";
import type { ConversationService } from "./conversations.js";
import type { DocumentService } from "./documents.js";
import type { ProposalService } from "./proposals.js";
import type { UsageService } from "./usage.js";
import type { MediaService } from "./media.js";

const TEMPLATES_BLOCK = Object.entries(DOCUMENT_TEMPLATES)
  .map(([type, tpl]) => `Шаблон для ${type}:\n${tpl}`)
  .join("\n\n");

const SYSTEM_PROMPT = [
  "Ты — ассистент мастера настольных ролевых игр (НРИ). Помогаешь собрать кампанию и подготовить её к игре за столом. Всегда отвечай по-русски.",
  "",
  "Веди живой диалог, как опытный соавтор:",
  "- Отвечай на вопросы мастера и давай советы (по сеттингу, системе, тону, структуре кампании, балансу сцен).",
  "- Если идея ещё расплывчата — задай 1–3 уточняющих вопроса (сеттинг, система, тон, завязка, герои), а не вываливай сразу всё.",
  "- Поддерживай любую систему и сеттинг (D&D, Pathfinder, Мир Тьмы, и т.д.). Объясняй термины, если просят.",
  "- Когда мастер просит «придумай», «продолжай» или описывает сюжет/сцену — бери инициативу и СРАЗУ оформляй предложениями всё значимое, что вводишь в ответе.",
  "- НИКОГДА не спрашивай «с чего начнём?» и не обещай «сделать в следующем сообщении». Всё значимое оформляй документами СРАЗУ, в текущем ответе. Не описывай сущность только текстом, откладывая её карточку.",
  "- Если мастер просит придумать сюжет/кампанию или «всё остальное» — в ОДНОМ ответе предложи полный стартовый набор: сюжетную арку, ключевых NPC, основные локации, по сцене на каждую заявленную сессию (например, на кампанию из 4 игр — 4 сцены), финального антагониста и центральный секрет/завязку.",
  "- Будь конкретным; в конце предлагай 2–4 варианта следующего шага — для УГЛУБЛЕНИЯ уже предложенного (улики, шифры, таймлайн, связи, новые сцены), а не для создания того, что ты уже назвал в ответе.",
  "",
  "Важно: ты НЕ можешь открывать сайты и ссылки. Если мастер ссылается на внешний источник — попроси прислать выдержки текстом, и работай по ним.",
  "",
  "Документы кампании ты предлагаешь, а не создаёшь напрямую: мастер их принимает или отклоняет.",
  "ГЛАВНОЕ ПРАВИЛО: каждая значимая названная сущность из твоего ответа должна стать отдельным предложением В ЭТОМ ЖЕ сообщении. Если ты назвал персонажа по имени, описал место, фракцию, тайну или сцену — заведи на это документ сразу, не откладывай «на потом» и не предлагай мастеру «сказать, что оформить карточками».",
  "- Каждый названный персонаж → npc (или pc, если это персонаж игрока). В детективе или интриге заведи ОТДЕЛЬНЫЙ npc на КАЖДОГО подозреваемого/ключевого персонажа.",
  "- Каждое названное место → location; организация или группировка → faction; ключевая тайна, разгадка или завязка → secret; описанная игровая сцена → scene.",
  "- Не оставляй ключевых персонажей и места только текстом ответа — мастер должен сразу получить их карточки.",
  "Не предлагай документы только когда задаёшь уточняющие вопросы, обсуждаешь идею в общих чертах или отвечаешь на простой вопрос.",
  "Чтобы предложить документы, добавь В КОНЦЕ ответа отдельный блок строго такого формата:",
  '```json',
  '{"proposals":[{"type":"npc","action":"create","title":"Гаст Морвен","content":"## Core Profile\\n- **Role / Occupation**: деревенский констебль\\n..."}]}',
  '```',
  "Поле type — один из ключей: pc (персонаж игрока, за которого играет игрок), npc (неигровой персонаж под управлением мастера), location (локация), faction (фракция), secret (секрет/завязка), scene (сцена), session (сессия), item (предмет), lore (лор: мир, история, космология), reference (референс: правила и механики), note (заметка).",
  "Различай pc и npc: если мастер просит «персонажа игрока», «героя партии», «персонажа за которого играют» — ставь type: pc. Обычных персонажей мира мастера — npc.",
  "title — короткое имя собственное в 1–3 слова (например, «Тихая комната», «Барон Кройц», «Глеб Кедров»). НЕ добавляй пояснений в скобках, кавычки-ёлочки, должности или описания в заголовок — так на сущность можно красиво ссылаться в тексте.",
  "Для npc и pc ВСЕГДА давай полное имя — имя и фамилию (или имя и родовое/клановое прозвище), а не одно голое имя: «Гаст Двукоготь», а не «Гаст»; «Лоран Свирель», а не «Лоран». Голое односложное имя допустимо только если персонаж по замыслу безымян или известен лишь по прозвищу.",
  "Поле action: «create» — создать новый документ (по умолчанию). «update» — ИЗМЕНИТЬ уже существующий документ с ТОЧНО ТАКИМ ЖЕ title (см. список ниже). Если мастер просит дополнить, расширить, переписать, переименовать или поправить существующий документ — ставь action: update и тот же title, а НЕ создавай дубликат с новым content.",
  "Поле content ОБЯЗАТЕЛЬНО заполняй по шаблону соответствующего типа (см. «Шаблоны по типам» ниже): сохраняй все заголовки разделов («## …») и подписи полей («- **…**:»), но после каждого поля впиши конкретное содержание. Не оставляй поля пустыми. Переносы строк в JSON экранируй как \\n. Для типа note шаблона нет — пиши свободным текстом.",
  "В поле content упоминай связанные сущности их ТОЧНЫМИ названиями (как в title) — тогда они подсветятся как ссылки в текстах кампании.",
  "Добавляй в массив proposals СТОЛЬКО объектов, сколько значимых сущностей ты ввёл или изменил. Текст ответа пиши обычным текстом, JSON-блок — только в самом конце.",
  "",
  "Шаблоны по типам (заполняй их в content):",
  TEMPLATES_BLOCK,
].join("\n");

export class BrainstormService {
  // Кэш проверки противоречий по хэшу документов — повторный запуск без изменений мгновенный.
  private consistencyCache = new Map<string, { hash: string; result: { issues: ConsistencyIssue[] } }>();

  constructor(
    private deps: { llmFor: (campaignId: string) => LLMProvider; conversations: ConversationService; proposals: ProposalService; documents: DocumentService; campaigns: CampaignService; usage?: UsageService; media?: MediaService },
  ) {}

  // Колбэк учёта токенов для запроса от имени кампании.
  private track(campaignId: string, feature: string) {
    return { onUsage: (u: Parameters<UsageService["record"]>[2]) => this.deps.usage?.record(campaignId, feature, u) };
  }

  // Готовит генерацию ответа мастерской: сохраняет вопрос и строит промт.
  // Стрим отдаётся вызывающему — фоновой задаче или синхронному respond.
  prepareRespond(campaignId: string, userMessage: string, signal?: AbortSignal, images?: ImageAttachment[]): { conversationId: string; stream: AsyncIterable<string> } {
    const { conversations, documents, campaigns } = this.deps;
    const llm = this.deps.llmFor(campaignId);
    const conv = conversations.getOrCreateForCampaign(campaignId);
    conversations.addMessage(conv.id, "user", userMessage, images?.length ? { images } : undefined);

    const history: LlmMessage[] = conversations
      .listMessages(conv.id)
      .map((m) => ({ role: m.role, content: m.content, ...(m.meta?.images?.length ? { images: this.deps.media!.toLlmImages(campaignId, m.meta.images) } : {}) }));

    // Настройки кампании — постоянный бриф (описание) и тон (реализм) идут в промт.
    const campaign = campaigns.get(campaignId);
    const brief = campaign?.description?.trim()
      ? `\n\nБриф кампании (учитывай во всех предложениях — тон, жанр, мир, домашние правила):\n${campaign.description.trim()}`
      : "";
    const tone = `\n\n${realismHint(campaign?.realism ?? "balanced")}`;

    // Список существующих документов — чтобы ИИ менял их (action: update), а не плодил дубликаты.
    const existing = documents.listByCampaign(campaignId);
    const docList = existing.length
      ? existing.slice(0, 120).map((d) => `«${d.title}» (${d.type})`).join(", ")
      : "(пока нет)";
    const system = `${SYSTEM_PROMPT}${brief}${tone}\n\nУже существующие документы кампании (для action: update используй их точные названия): ${docList}.`;

    return { conversationId: conv.id, stream: llm.complete({ system, messages: history }, { ...this.track(campaignId, "workshop"), signal }) };
  }

  // Завершение генерации: разбирает предложения, сохраняет ответ и предложения.
  finishRespond(campaignId: string, conversationId: string, full: string): BrainstormResponse {
    const { conversations, proposals } = this.deps;
    const { reply, proposals: drafts } = parseProposals(full);
    conversations.addMessage(conversationId, "assistant", reply);
    const created: Proposal[] = drafts.map((draft) =>
      proposals.create({ campaignId, conversationId, draft }),
    );
    return { conversationId, reply, proposals: created };
  }

  async respond(campaignId: string, userMessage: string, images?: ImageAttachment[]): Promise<BrainstormResponse> {
    const { conversationId, stream } = this.prepareRespond(campaignId, userMessage, undefined, images);
    let full = "";
    for await (const chunk of stream) {
      full += chunk;
    }
    return this.finishRespond(campaignId, conversationId, full);
  }

  // «Мир пока что»: сводка кампании по беседе + один открытый вопрос (как в Arks).
  async worldSummary(campaignId: string): Promise<{ summary: string; question: string }> {
    const { conversations, campaigns } = this.deps;
    const llm = this.deps.llmFor(campaignId);
    const conv = conversations.getOrCreateForCampaign(campaignId);
    const history = conversations.listMessages(conv.id);
    if (history.length === 0) return { summary: "", question: "" };

    const campaign = campaigns.get(campaignId);
    const brief = campaign?.description?.trim() ? `\nБриф кампании: ${campaign.description.trim()}` : "";
    const transcript = history.map((m) => `${m.role === "user" ? "Мастер" : "ИИ"}: ${m.content}`).join("\n\n");

    let out = "";
    for await (const chunk of llm.complete({
      system:
        "Ты ведёшь живую сводку мира кампании для мастера НРИ. По беседе мастера и ассистента: " +
        "(1) напиши ОДИН связный абзац «Мир пока что» — что уже вырисовывается: тон, завязка, ключевые сущности, центральный конфликт. Живо и по делу, по-русски, без списков и заголовков. " +
        "Если беседы почти нет — кратко скажи, что мир только начинает складываться. " +
        "(2) Затем с новой строки, начиная строго со слова «ВОПРОС:», задай ОДИН самый важный открытый вопрос, который стоит прояснить дальше." +
        brief,
      messages: [{ role: "user", content: `Беседа:\n${transcript}\n\nСделай сводку.` }],
    }, this.track(campaignId, "world"))) {
      out += chunk;
    }

    const text = out.trim();
    const m = /(^|\n)\s*ВОПРОС\s*:/i.exec(text);
    if (m && m.index !== undefined) {
      const summary = text.slice(0, m.index).trim();
      const question = text.slice(m.index).replace(/^[\s\S]*?ВОПРОС\s*:\s*/i, "").trim();
      return { summary, question };
    }
    return { summary: text, question: "" };
  }

  // Проверка кампании на фактические противоречия между документами.
  async checkConsistency(campaignId: string): Promise<{ issues: ConsistencyIssue[] }> {
    const { documents } = this.deps;
    const llm = this.deps.llmFor(campaignId);
    const docs = documents.listByCampaign(campaignId);
    if (docs.length < 2) return { issues: [] };
    // Хэш содержимого — если ничего не менялось, отдаём кэш без тяжёлого запроса к ИИ.
    const hash = docs.map((d) => `${d.id}:${d.updatedAt}:${d.status ?? ""}`).sort().join("|");
    const cached = this.consistencyCache.get(campaignId);
    if (cached && cached.hash === hash) return cached.result;
    const digest = docs.slice(0, 80).map((d) => {
      const body = proseMirrorToText(d.contentJson).replace(/\s+/g, " ").trim().slice(0, 300);
      const status = d.status ? `, статус: ${d.status}` : "";
      return `«${d.title}» (${d.type}${status}) — ${body || "(пусто)"}`;
    }).join("\n");

    let out = "";
    for await (const chunk of llm.complete({
      system:
        "Ты — редактор-continuity мастера НРИ. Найди ФАКТИЧЕСКИЕ противоречия между документами кампании: " +
        "статусы (жив/погиб), хронология и даты, отношения, местоположения, взаимоисключающие факты. " +
        "Верни ТОЛЬКО JSON вида {\"issues\":[{\"documents\":[\"«A»\",\"«B»\"],\"contradiction\":\"в чём расхождение\",\"fix\":\"как устранить\"}]}. " +
        "Цитируй ТОЧНЫЕ названия документов из списка. Если явных противоречий нет — верни {\"issues\":[]}. " +
        "Не выдумывай и не придирайся к стилю — только реальные фактические расхождения.",
      messages: [{ role: "user", content: `Документы кампании:\n${digest}\n\nНайди противоречия.` }],
    }, this.track(campaignId, "consistency"))) {
      out += chunk;
    }
    const result = { issues: parseIssues(out) };
    this.consistencyCache.set(campaignId, { hash, result });
    return result;
  }

  // Итоговая сводка сыгранной сессии: ИТОГИ (что было) + ЗАДЕЛ (крючки на следующую).
  async sessionSummary(sessionId: string): Promise<{ summary: string; seed: string }> {
    const { documents } = this.deps;
    const sess = documents.get(sessionId);
    if (!sess) return { summary: "", seed: "" };
    const llm = this.deps.llmFor(sess.campaignId);
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

    let out = "";
    for await (const chunk of llm.complete({
      system:
        "Ты — ассистент мастера НРИ. По логу и заметкам СЫГРАННОЙ сессии составь два блока по-русски. " +
        "(1) Блок ИТОГИ: 2–4 предложения — что произошло, ключевые решения игроков, изменения статусов, добыча. Живым языком, без списков. " +
        "(2) С новой строки, начиная строго со слова «ЗАДЕЛ:», дай 2–4 зацепки для следующей сессии — незакрытые нити, реакции мира, назревающие угрозы. Каждую с новой строки как «- …».",
      messages: [{ role: "user", content: `Лог сессии:\n${log || "(пусто)"}\n\nХод игры (чат с ИИ-мастером):\n${chatTail || "(пусто)"}\n\nЗаметки сессии:\n${text || "(пусто)"}` }],
    }, this.track(sess.campaignId, "session-summary"))) {
      out += chunk;
    }

    const t = out.trim();
    const unlabel = (s: string) => s.replace(/^\s*ИТОГИ\s*:\s*/i, "").trim();
    const m = /(^|\n)\s*ЗАДЕЛ\s*:/i.exec(t);
    if (m && m.index !== undefined) {
      return { summary: unlabel(t.slice(0, m.index)), seed: t.slice(m.index).replace(/^[\s\S]*?ЗАДЕЛ\s*:\s*/i, "").trim() };
    }
    return { summary: unlabel(t), seed: "" };
  }
}
