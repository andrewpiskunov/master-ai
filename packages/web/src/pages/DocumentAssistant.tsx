import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { streamComplete } from "../api/stream.js";
import { Markdown } from "../ui/Markdown.js";
import { useToast } from "../ui/toast.js";

interface Msg { role: "user" | "assistant"; content: string }

// Эфемерный чат-помощник по конкретному документу: подсказывает правки и дополнения.
export function DocumentAssistant({
  title,
  typeLabel,
  getText,
}: {
  title: string;
  typeLabel: string;
  getText: () => string;
}) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            `Отвечай по-русски, кратко и по делу: предлагай конкретные правки, идеи и дополнения.`,
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
          <p className="chat-empty">Спросите ИИ, как улучшить или дополнить этот документ.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "Вы" : "ИИ"}</div>
            {m.content ? <Markdown>{m.content}</Markdown> : (
              <div className="typing" aria-label="ИИ печатает"><span></span><span></span><span></span></div>
            )}
          </div>
        ))}
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
