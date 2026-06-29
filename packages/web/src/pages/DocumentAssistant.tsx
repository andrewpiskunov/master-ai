import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { streamComplete } from "../api/stream.js";
import { Markdown } from "../ui/Markdown.js";
import { useToast } from "../ui/toast.js";

interface Msg { role: "user" | "assistant"; content: string }

// Беседы по документам переживают переключение между карточками в рамках сессии.
const chatCache = new Map<string, Msg[]>();

// Выделяет предлагаемый ИИ полный текст документа из блока ```doc … ```.
function parseAssistant(content: string): { intro: string; doc: string | null } {
  const closed = /```doc\s*\n([\s\S]*?)```/.exec(content);
  if (closed) return { intro: content.replace(closed[0], "").trim(), doc: closed[1].trim() };
  const open = content.indexOf("```doc");
  if (open >= 0) return { intro: content.slice(0, open).trim(), doc: null };
  return { intro: content, doc: null };
}

export function DocumentAssistant({
  docId,
  title,
  typeLabel,
  getText,
  onApply,
}: {
  docId: string;
  title: string;
  typeLabel: string;
  getText: () => string;
  onApply: (text: string) => void;
}) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Msg[]>(() => chatCache.get(docId) ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { chatCache.set(docId, messages); }, [docId, messages]);

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

  async function send(e: { preventDefault: () => void }) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: "user", content: text } as Msg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      await streamComplete(
        {
          system:
            `Ты — соавтор мастера настольных ролевых игр. Помогаешь дорабатывать документ кампании ` +
            `(тип: ${typeLabel}, название: «${title}»). Текущий текст документа:\n${getText() || "(пусто)"}\n\n` +
            `Когда пользователь просит изменить, переписать или дополнить документ — верни ПОЛНУЮ новую версию ` +
            `текста документа внутри блока \`\`\`doc и \`\`\` (обычный текст; при необходимости «## Заголовок», списки «- »). ` +
            `Вне блока коротко, по-русски, поясни, что изменил. Если правка документа не нужна — отвечай обычным текстом без блока.`,
          messages: history,
        },
        (chunk) => {
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: last.content + chunk };
            return copy;
          });
        },
      );
    } catch {
      showToast("Не удалось получить ответ ИИ");
      setMessages((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.content === "")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel doc-assistant">
      <h3>Помощник по документу</h3>
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
          const { intro, doc } = parseAssistant(m.content);
          return (
            <div key={i} className="msg msg-assistant">
              <div className="msg-role">ИИ</div>
              {m.content
                ? (
                  <>
                    {intro && <Markdown>{intro}</Markdown>}
                    {doc && (
                      <div className="apply-card">
                        <div className="apply-preview">{doc}</div>
                        <button type="button" className="apply-btn" onClick={() => { onApply(doc); showToast("Текст применён — не забудьте сохранить"); }}>
                          <Check size={15} /> Применить к документу
                        </button>
                      </div>
                    )}
                  </>
                )
                : (
                  <div className="typing" aria-label="ИИ печатает"><span></span><span></span><span></span></div>
                )}
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={send}>
        <label htmlFor="doc-assistant-input" className="sr-only">Сообщение помощнику</label>
        <textarea
          id="doc-assistant-input"
          ref={textareaRef}
          rows={1}
          placeholder="Спросите про документ…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
          }}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>Отправить</button>
      </form>
    </aside>
  );
}
