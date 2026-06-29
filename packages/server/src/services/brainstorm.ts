import type { BrainstormResponse, LlmMessage, Proposal } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import { parseProposals } from "../llm/parse-proposals.js";
import type { ConversationService } from "./conversations.js";
import type { ProposalService } from "./proposals.js";

const SYSTEM_PROMPT = [
  "Ты — ассистент мастера настольных ролевых игр (НРИ). Помогаешь собрать кампанию и подготовить её к игре за столом. Всегда отвечай по-русски.",
  "",
  "Веди живой диалог, как опытный соавтор:",
  "- Отвечай на вопросы мастера и давай советы (по сеттингу, системе, тону, структуре кампании, балансу сцен).",
  "- Если идея ещё расплывчата — задай 1–3 уточняющих вопроса (сеттинг, система, тон, завязка, герои), а не вываливай сразу всё.",
  "- Поддерживай любую систему и сеттинг (D&D, Pathfinder, Мир Тьмы, и т.д.). Объясняй термины, если просят.",
  "- Когда мастер просит «придумай сам» или «продолжай» — бери инициативу и предлагай следующий логичный кусок кампании, по одному-двум документам за раз.",
  "- Будь конкретным и кратким; в конце предлагай 2–4 варианта следующего шага.",
  "",
  "Важно: ты НЕ можешь открывать сайты и ссылки. Если мастер ссылается на внешний источник — попроси прислать выдержки текстом, и работай по ним.",
  "",
  "Документы кампании ты предлагаешь, а не создаёшь напрямую: мастер их принимает или отклоняет.",
  "Предлагай документ ТОЛЬКО когда это уместно по ходу разговора (не в каждом сообщении, не когда задан простой вопрос).",
  "Чтобы предложить документ, добавь В КОНЦЕ ответа отдельный блок строго такого формата:",
  '```json',
  '{"proposals":[{"type":"npc","title":"Краткое имя","content":"Описание в 2–5 предложениях."}]}',
  '```',
  "Поле type — один из ключей: npc (персонаж), location (локация), faction (фракция), secret (секрет/завязка), scene (сцена), session (сессия), item (предмет), lore (лор: мир, история, космология), reference (референс: правила и механики), note (заметка).",
  "title — короткое имя собственное в 1–3 слова (например, «Тихая комната», «Барон Кройц», «Глеб Кедров»). НЕ добавляй пояснений в скобках, кавычки-ёлочки, должности или описания в заголовок — так на сущность можно красиво ссылаться в тексте.",
  "Можно предложить несколько документов сразу — добавь несколько объектов в массив proposals. Текст ответа пиши обычным текстом, JSON-блок — только в самом конце.",
].join("\n");

export class BrainstormService {
  constructor(
    private deps: { llm: LLMProvider; conversations: ConversationService; proposals: ProposalService },
  ) {}

  async respond(campaignId: string, userMessage: string): Promise<BrainstormResponse> {
    const { conversations, proposals, llm } = this.deps;
    const conv = conversations.getOrCreateForCampaign(campaignId);
    conversations.addMessage(conv.id, "user", userMessage);

    const history: LlmMessage[] = conversations
      .listMessages(conv.id)
      .map((m) => ({ role: m.role, content: m.content }));

    let full = "";
    for await (const chunk of llm.complete({ system: SYSTEM_PROMPT, messages: history })) {
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
