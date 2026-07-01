import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ConversationMessage, Proposal } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { useToast } from "../../ui/toast.js";

interface WorldState { summary: string; question: string }

interface WorkshopChat {
  messages: ConversationMessage[];
  proposals: Proposal[];
  busy: boolean;
  // Ждём фоновое приветствие только что созданной кампании — показываем «печатает…»,
  // но НЕ блокируем ввод (это не запрос пользователя).
  awaitingWelcome: boolean;
  draft: string;
  setDraft: (v: string) => void;
  send: (text: string) => void;
  approve: (id: string) => void;
  reject: (id: string) => void;
  world: WorldState | null;
  worldBusy: boolean;
  refreshWorld: () => void;
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
  const [awaitingWelcome, setAwaitingWelcome] = useState(false);
  // Черновик сообщения живёт здесь, чтобы не теряться при переключении вкладок.
  const [draft, setDraft] = useState("");
  const [world, setWorld] = useState<WorldState | null>(null);
  const [worldBusy, setWorldBusy] = useState(false);
  // Как только в беседе появилось хоть одно сообщение (приветствие или реплика
  // пользователя) — прекращаем опрос, чтобы он не затирал сообщения.
  const hasMessagesRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const MAX_TRIES = 20; // ~30с ожидания приветствия только что созданной кампании
    // Приветствие ИИ генерируется на сервере в фоне — пока беседа пуста, показываем
    // «печатает…» и опрашиваем, чтобы сообщение появилось само, без ручной перезагрузки.
    const load = () => {
      if (cancelled || hasMessagesRef.current) return;
      api.getConversation(campaignId)
        .then((msgs) => {
          if (cancelled || hasMessagesRef.current) return;
          if (msgs.length > 0) {
            hasMessagesRef.current = true;
            setMessages(msgs);
            setAwaitingWelcome(false);
            return;
          }
          setMessages([]);
          if (tries < MAX_TRIES) {
            setAwaitingWelcome(true);
            tries++;
            timer = setTimeout(load, 1500);
          } else {
            setAwaitingWelcome(false);
          }
        })
        .catch(() => { if (!cancelled) { setAwaitingWelcome(false); showToast("Не удалось загрузить беседу"); } });
    };
    load();
    api.listProposals(campaignId, "pending").then(setProposals).catch(() => showToast("Не удалось загрузить предложения"));
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [campaignId, showToast]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    hasMessagesRef.current = true; // прекращаем опрос приветствия — дальше беседа не пуста
    setAwaitingWelcome(false);
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

  const refreshWorld = useCallback(() => {
    setWorldBusy(true);
    api.worldSummary(campaignId)
      .then(setWorld)
      .catch(() => showToast("Не удалось обновить сводку мира"))
      .finally(() => setWorldBusy(false));
  }, [campaignId, showToast]);

  // Один раз подтягиваем сводку, когда в беседе уже есть обмен репликами.
  useEffect(() => {
    if (!world && !worldBusy && messages.length >= 2) refreshWorld();
  }, [messages.length, world, worldBusy, refreshWorld]);

  return <Ctx.Provider value={{ messages, proposals, busy, awaitingWelcome, draft, setDraft, send, approve, reject, world, worldBusy, refreshWorld }}>{children}</Ctx.Provider>;
}

export function useWorkshopChat(): WorkshopChat {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkshopChat должен использоваться внутри WorkshopChatProvider");
  return ctx;
}
