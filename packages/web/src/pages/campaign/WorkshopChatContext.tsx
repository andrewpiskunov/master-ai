import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ConversationMessage, Proposal } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { useToast } from "../../ui/toast.js";

interface WorkshopChat {
  messages: ConversationMessage[];
  proposals: Proposal[];
  busy: boolean;
  draft: string;
  setDraft: (v: string) => void;
  send: (text: string) => void;
  approve: (id: string) => void;
  reject: (id: string) => void;
}

const Ctx = createContext<WorkshopChat | null>(null);

// Состояние чата живёт здесь, на уровне рабочего пространства кампании,
// чтобы переключение между разделами не прерывало запрос к ИИ и не теряло беседу.
export function WorkshopChatProvider({
  campaignId,
  onApproved,
  children,
}: {
  campaignId: string;
  onApproved: () => void;
  children: ReactNode;
}) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  // Черновик сообщения живёт здесь, чтобы не теряться при переключении вкладок.
  const [draft, setDraft] = useState("");

  useEffect(() => {
    api.getConversation(campaignId).then(setMessages).catch(() => showToast("Не удалось загрузить беседу"));
    api.listProposals(campaignId, "pending").then(setProposals).catch(() => showToast("Не удалось загрузить предложения"));
  }, [campaignId, showToast]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: trimmed, createdAt: new Date().toISOString() },
    ]);
    setBusy(true);
    api.brainstorm(campaignId, trimmed)
      .then((res) => {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: res.reply, createdAt: new Date().toISOString() },
        ]);
        setProposals((prev) => [...prev, ...res.proposals]);
      })
      .catch(() => showToast("Не удалось получить ответ ИИ"))
      .finally(() => setBusy(false));
  }, [busy, campaignId, showToast]);

  const approve = useCallback((id: string) => {
    api.approveProposal(id)
      .then(() => { setProposals((prev) => prev.filter((p) => p.id !== id)); onApproved(); })
      .catch(() => showToast("Не удалось принять предложение"));
  }, [onApproved, showToast]);

  const reject = useCallback((id: string) => {
    api.rejectProposal(id)
      .then(() => setProposals((prev) => prev.filter((p) => p.id !== id)))
      .catch(() => showToast("Не удалось отклонить предложение"));
  }, [showToast]);

  return <Ctx.Provider value={{ messages, proposals, busy, draft, setDraft, send, approve, reject }}>{children}</Ctx.Provider>;
}

export function useWorkshopChat(): WorkshopChat {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkshopChat должен использоваться внутри WorkshopChatProvider");
  return ctx;
}
