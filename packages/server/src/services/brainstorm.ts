import type { BrainstormResponse, LlmMessage, Proposal } from "@master-ai/shared";
import type { LLMProvider } from "../llm/provider.js";
import { parseProposals } from "../llm/parse-proposals.js";
import type { ConversationService } from "./conversations.js";
import type { ProposalService } from "./proposals.js";

const SYSTEM_PROMPT = [
  "Ты — соавтор мастера настольных ролевых игр. Отвечай по-русски.",
  "Когда уместно предложить готовый материал (NPC, локацию, секрет, сцену и т.п.),",
  "добавь В КОНЦЕ ответа блок ```json {\"proposals\":[{\"type\":\"npc\",\"title\":\"...\",\"content\":\"...\"}]}``` .",
  "Поле type — один из ключей: npc, location, faction, secret, scene, session, item, lore, note.",
].join(" ");

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
