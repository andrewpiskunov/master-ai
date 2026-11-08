import type { FastifyInstance } from "fastify";
import { NewCampaignSchema, CampaignPatchSchema, type LlmUsage } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import type { RouteDependencies, IdParams } from "./dependencies.js";

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


export function registerCampaignRoutes(app: FastifyInstance, deps: Pick<RouteDependencies, "campaignsSvc" | "conversationsSvc" | "llmFor" | "trackUsage">): void {
  const { campaignsSvc, conversationsSvc, llmFor, trackUsage } = deps;
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
      .then((text) => {
        if (campaignsSvc.get(campaign.id) && conversationsSvc.listMessages(conv.id).length === 0) {
          conversationsSvc.addMessage(conv.id, "assistant", text);
        }
      })
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

}
