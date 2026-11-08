import type { ConversationMessage } from "../schemas/proposal.js";

// История хранится целиком, но модель получает только последнюю тему.
export function activeWorkshopHistory<T extends Pick<ConversationMessage, "meta">>(messages: T[]): T[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].meta?.workshopTopicStart === true) return messages.slice(index + 1);
  }
  return messages;
}
