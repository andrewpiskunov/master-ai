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
  // Останавливает генерацию мастерской — набранный текст сохранится как ответ.
  stop: () => void;
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
  // Токен активного опроса серверной генерации мастерской (см. DocumentAssistant).
  const pollTokenRef = useRef(0);

  // Прячет из частичного ответа блоки ```json с предложениями (включая незакрытый хвост).
  const stripJsonBlocks = (text: string): string => {
    const closed = text.replace(/```json[\s\S]*?```/gi, "");
    const open = closed.search(/```json/i);
    return (open >= 0 ? closed.slice(0, open) : closed).trim();
  };

  // Опрашивает серверную задачу мастерской: дорисовывает частичный ответ,
  // по завершении подменяет беседу и предложения авторитетными серверными.
  const pollBrainstorm = useCallback(async () => {
    const token = ++pollTokenRef.current;
    for (;;) {
      let st: { running: boolean; partial: string; error: string | null };
      try {
        st = await api.brainstormStatus(campaignId);
      } catch {
        st = { running: false, partial: "", error: "нет связи с сервером" };
      }
      if (token !== pollTokenRef.current) return;
      const body = stripJsonBlocks(st.partial);
      setMessages((prev) => {
        const rest = prev.filter((m) => m.id !== "streaming");
        return body ? [...rest, { id: "streaming", role: "assistant" as const, content: body, createdAt: "" }] : rest;
      });
      if (!st.running) {
        if (st.error) showToast("Не удалось получить ответ ИИ");
        const [msgs, props] = await Promise.all([
          api.getConversation(campaignId).catch(() => null),
          api.listProposals(campaignId, "pending").catch(() => null),
        ]);
        if (token !== pollTokenRef.current) return;
        if (msgs) {
          hasMessagesRef.current = msgs.length > 0;
          setMessages(msgs);
        }
        if (props) setProposals(props);
        setBusy(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      if (token !== pollTokenRef.current) return;
    }
  }, [campaignId, showToast]);

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
    // Если по кампании прямо сейчас идёт серверная генерация — подхватываем её.
    api.brainstormStatus(campaignId)
      .then((st) => {
        if (cancelled || !st.running) return;
        hasMessagesRef.current = true;
        setAwaitingWelcome(false);
        setBusy(true);
        void pollBrainstorm();
      })
      .catch(() => {});
    return () => { cancelled = true; if (timer) clearTimeout(timer); pollTokenRef.current++; };
  }, [campaignId, showToast, pollBrainstorm]);

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
    // Генерация выполняется на сервере фоновой задачей — переживает навигацию
    // и закрытие вкладки; клиент опрашивает статус и дорисовывает частичный ответ.
    api.startBrainstorm(campaignId, trimmed)
      .then(() => pollBrainstorm())
      .catch(() => {
        showToast("Не удалось запустить генерацию");
        setMessages((prev) => prev.slice(0, -1)); // откат оптимистичного вопроса
        setBusy(false);
      });
  }, [busy, campaignId, showToast, pollBrainstorm]);

  const stop = useCallback(() => { void api.stopBrainstorm(campaignId); }, [campaignId]);

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

  return <Ctx.Provider value={{ messages, proposals, busy, awaitingWelcome, draft, setDraft, send, stop, approve, reject, world, worldBusy, refreshWorld }}>{children}</Ctx.Provider>;
}

export function useWorkshopChat(): WorkshopChat {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkshopChat должен использоваться внутри WorkshopChatProvider");
  return ctx;
}
