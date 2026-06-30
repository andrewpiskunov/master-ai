import { DOCUMENT_TEMPLATES, realismHint, type BrainstormResponse, type LlmMessage, type Proposal } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import { parseProposals } from "../llm/parse-proposals.js";
import type { CampaignService } from "./campaigns.js";
import type { ConversationService } from "./conversations.js";
import type { DocumentService } from "./documents.js";
import type { ProposalService } from "./proposals.js";

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
  constructor(
    private deps: { llm: LLMProvider; conversations: ConversationService; proposals: ProposalService; documents: DocumentService; campaigns: CampaignService },
  ) {}

  async respond(campaignId: string, userMessage: string): Promise<BrainstormResponse> {
    const { conversations, proposals, documents, campaigns, llm } = this.deps;
    const conv = conversations.getOrCreateForCampaign(campaignId);
    conversations.addMessage(conv.id, "user", userMessage);

    const history: LlmMessage[] = conversations
      .listMessages(conv.id)
      .map((m) => ({ role: m.role, content: m.content }));

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

    let full = "";
    for await (const chunk of llm.complete({ system, messages: history })) {
      full += chunk;
    }

    const { reply, proposals: drafts } = parseProposals(full);
    conversations.addMessage(conv.id, "assistant", reply);

    const created: Proposal[] = drafts.map((draft) =>
      proposals.create({ campaignId, conversationId: conv.id, draft }),
    );

    return { conversationId: conv.id, reply, proposals: created };
  }
}
