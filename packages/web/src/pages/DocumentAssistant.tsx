import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Square, Trash2 } from "lucide-react";
import { api } from "../api/client.js";
import { Markdown } from "../ui/Markdown.js";
import { MentionTextarea } from "../ui/MentionTextarea.js";
import { useToast } from "../ui/toast.js";
import { entityBlocksPrompt, parseAssistant, type EditEntity, type NewEntity } from "./assistant-blocks.js";
import { AssistantAnswer } from "./AssistantAnswer.js";

interface Msg { role: "user" | "assistant"; content: string; createdAt?: string }

export function DocumentAssistant({
  docId,
  title,
  typeLabel,
  template,
  documents,
  campaignBrief,
  getText,
  appliedBlocks,
  docUpdatedAt,
  onApply,
  onCreateEntity,
  onEditEntity,
  onMessage,
  onProposeDoc,
  clearConfirmText,
}: {
  docId: string;
  title: string;
  typeLabel: string;
  template?: string;
  documents: { title: string; type: string }[];
  campaignBrief?: string;
  getText: () => string;
  // Ключи блоков ```doc```, уже применённых к документу (из fields) — переживают перезаход.
  appliedBlocks?: string[];
  // Время последнего изменения КОНТЕНТА документа (fields.contentUpdatedAt, для легаси —
  // updatedAt): блоки из сообщений старше него без персистентного ключа помечаются устаревшими.
  docUpdatedAt?: string;
  onApply: (text: string) => void;
  onCreateEntity: (entity: NewEntity) => boolean | Promise<boolean>;
  onEditEntity: (edit: EditEntity) => boolean | Promise<boolean>;
  // Вызывается с текстом каждой завершённой реплики (вопрос и ответ) —
  // режим игры использует это, чтобы открывать обсуждаемые документы в просмотрщике.
  onMessage?: (content: string) => void;
  // Вызывается, когда ассистент предлагает создать новую сущность — режим игры
  // показывает её превью в просмотрщике (документа ещё нет в базе).
  onProposeDoc?: (entity: NewEntity) => void;
  // Текст второго шага подтверждения очистки беседы. У документов типа «session»
  // передаётся особый текст: беседа общая с режимом игры, в мета-полях — лог событий.
  clearConfirmText?: string;
}) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Двухшаговая очистка беседы: первый клик — подтверждение, второй — удаление.
  const [confirmClear, setConfirmClear] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Токен активного опроса серверной генерации: смена документа или новый запуск
  // делает предыдущий цикл опроса «чужим», и он молча завершается.
  const pollTokenRef = useRef(0);

  // Опрашивает серверную задачу генерации: дорисовывает partial в последнее
  // сообщение, по завершении подменяет историю авторитетной серверной версией.
  async function pollJob(notify: boolean): Promise<void> {
    const token = ++pollTokenRef.current;
    for (;;) {
      let st: { running: boolean; partial: string; error: string | null };
      try {
        st = await api.assistantStatus(docId);
      } catch {
        st = { running: false, partial: "", error: "нет связи с сервером" };
      }
      if (token !== pollTokenRef.current) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content: st.partial }];
      });
      if (!st.running) {
        if (st.error) showToast("Не удалось получить ответ ИИ");
        const msgs = await api.getDocumentConversation(docId).catch(() => null);
        if (token !== pollTokenRef.current) return;
        if (msgs) {
          setMessages(msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
          const last = msgs[msgs.length - 1];
          if (notify && last?.role === "assistant") {
            onMessage?.(last.content);
            if (onProposeDoc) parseAssistant(last.content).newDocs.forEach((nd) => onProposeDoc(nd));
          }
        }
        setBusy(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      if (token !== pollTokenRef.current) return;
    }
  }

  // История беседы по документу хранится на сервере — загружаем её при открытии.
  // Если по документу прямо сейчас идёт серверная генерация — подхватываем её.
  useEffect(() => {
    let cancelled = false;
    api.getDocumentConversation(docId)
      .then(async (msgs) => {
        if (cancelled) return;
        setMessages(msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
        const st = await api.assistantStatus(docId).catch(() => null);
        if (cancelled || !st?.running) return;
        setMessages((prev) => [...prev, { role: "assistant", content: st.partial }]);
        setBusy(true);
        void pollJob(true);
      })
      .catch(() => {});
    return () => { cancelled = true; pollTokenRef.current++; };
  // pollJob намеренно вне зависимостей: пересоздаётся каждый рендер, а цикл держится за токен
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    const max = 160;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }
  useEffect(autoGrow, [input]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(e: { preventDefault: () => void }, override?: string) {
    e.preventDefault();
    const text = (override ?? input).trim();
    if (!text || busy) return;
    setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    if (override === undefined) setInput(""); // быстрые действия не трогают черновик
    setBusy(true);
    onMessage?.(text);
    // Генерация выполняется на сервере фоновой задачей (переживает навигацию);
    // вопрос сохраняет сервер, клиент только опрашивает статус.
    try {
      await api.startAssistant(
        docId,
        text,
        (
          `Ты — соавтор мастера настольных ролевых игр. Помогаешь дорабатывать документ кампании ` +
            `(тип: ${typeLabel}, название: «${title}»). ` +
            (campaignBrief?.trim() ? `Бриф кампании (учитывай тон, жанр, мир, правила):\n${campaignBrief.trim()}\n\n` : "") +
            `Текущий текст документа:\n${getText() || "(пусто)"}\n\n` +
            (template
              ? `Структура (шаблон) документов этого типа — заполняй и дорабатывай по ней, ` +
                `сохраняя заголовки и подписи разделов:\n${template}\n\n`
              : "") +
            `Когда пользователь просит изменить, переписать или дополнить ЭТОТ документ — верни ПОЛНУЮ новую версию ` +
            `текста документа внутри блока \`\`\`doc и \`\`\` (обычный текст; при необходимости «## Заголовок», списки «- »). ` +
            `Вне блока коротко, по-русски, поясни, что изменил.\n\n` +
            entityBlocksPrompt(documents)
        ),
      );
      await pollJob(true);
    } catch {
      showToast("Не удалось запустить генерацию");
      // откатываем оптимистичные вопрос и заглушку ответа
      setMessages((prev) => prev.slice(0, -2));
      setBusy(false);
    }
  }

  // Сообщение «устарело», если документ сохранялся после него: применять такой блок
  // рискованно (перезапишет более свежие правки), а «оживать» после перезахода он не должен.
  const isStale = (m: Msg): boolean => {
    if (!docUpdatedAt || !m.createdAt) return false;
    const mt = Date.parse(m.createdAt);
    const dt = Date.parse(docUpdatedAt);
    return Number.isFinite(mt) && Number.isFinite(dt) && mt < dt;
  };

  const currentText = getText().trim();

  return (
    <div className="doc-assistant">
      <div className="chat doc-chat" ref={chatRef}>
        {messages.length === 0 && !busy && (
          <p className="chat-empty">Спросите ИИ, как улучшить или дополнить этот документ — и применяйте правки одной кнопкой.</p>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="msg msg-user">
                <div className="msg-role">Вы</div>
                <Markdown>{m.content}</Markdown>
              </div>
            );
          }
          return (
            <div key={i} className="msg msg-assistant">
              <div className="msg-role">ИИ</div>
              {m.content ? (
                <AssistantAnswer
                  content={m.content}
                  stale={isStale(m)}
                  currentText={currentText}
                  appliedBlocks={appliedBlocks ?? []}
                  documents={documents}
                  onApply={onApply}
                  onCreateEntity={onCreateEntity}
                  onEditEntity={onEditEntity}
                />
              ) : (
                <div className="typing" aria-label="ИИ печатает"><span></span><span></span><span></span></div>
              )}
            </div>
          );
        })}
      </div>
      <div className="chat-quick">
        <button
          type="button"
          className="chat-quick-chip"
          disabled={busy}
          onClick={() => send({ preventDefault() {} }, "На основе этого документа предложи связанные сущности, которые стоит завести — например его фракцию, ключевую локацию или связанных персонажей, явно или неявно упомянутых в тексте. Для каждой верни отдельный блок new-doc. Не дублируй уже существующие документы кампании.")}
        >
          <Sparkles size={13} /> Предложить связанные
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            className={`chat-quick-chip chat-clear${confirmClear ? " confirm" : ""}`}
            disabled={busy}
            onBlur={() => setConfirmClear(false)}
            onClick={() => {
              if (!confirmClear) { setConfirmClear(true); return; }
              setConfirmClear(false);
              api.clearDocumentConversation(docId)
                .then(() => { setMessages([]); })
                .catch(() => showToast("Не удалось очистить беседу"));
            }}
            title="Удалить историю беседы с ассистентом по этому документу"
          >
            <Trash2 size={13} /> {confirmClear ? (clearConfirmText ?? "Точно очистить?") : "Очистить беседу"}
          </button>
        )}
      </div>
      <form className="chat-form" onSubmit={send}>
        <label htmlFor="doc-assistant-input" className="sr-only">Сообщение помощнику</label>
        <MentionTextarea
          id="doc-assistant-input"
          ref={textareaRef}
          rows={2}
          placeholder="Спросите про документ… (@ — вставить сущность)"
          value={input}
          onChange={setInput}
          onEnter={() => send({ preventDefault() {} })}
          mentions={documents}
          disabled={busy}
        />
        {busy ? (
          <button type="button" className="chat-send chat-stop" onClick={() => void api.stopAssistant(docId)} title="Остановить генерацию — набранный текст останется">
            <Square size={13} strokeWidth={2.2} /> <span>Стоп</span>
          </button>
        ) : (
          <button type="submit" className="chat-send" title="Отправить">
            <Send size={15} strokeWidth={1.9} /> <span>Отправить</span>
          </button>
        )}
      </form>
    </div>
  );
}
