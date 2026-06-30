import { useEffect, useRef } from "react";
import { Markdown } from "../ui/Markdown.js";
import { MentionTextarea } from "../ui/MentionTextarea.js";
import type { MentionItem } from "../mentions.js";
import { useWorkshopChat } from "./campaign/WorkshopChatContext.js";
import { TypeTag } from "./campaign/shared.js";

export function WorkshopPanel({ mentions }: { mentions?: MentionItem[] }) {
  const { messages, busy, send, draft, setDraft } = useWorkshopChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Подгоняем высоту поля под содержимое; скролл показываем только при достижении max-height.
  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    const max = 200;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }
  useEffect(autoGrow, [draft]);

  // Держим чат прокрученным вниз — в т.ч. при возврате в раздел и при ответе ИИ.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    send(text);
  }

  return (
    <section className="workshop">
      <div className="chat" ref={chatRef}>
        {messages.length === 0 && !busy && (
          <p className="chat-empty">Опишите идею кампании — ИИ ответит и предложит документы.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "Вы" : "ИИ"}</div>
            <Markdown mentions={mentions}>{m.content}</Markdown>
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="msg-role">ИИ</div>
            <div className="typing" aria-label="ИИ печатает">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="brainstorm-input" className="sr-only">Сообщение</label>
        <MentionTextarea
          id="brainstorm-input"
          ref={textareaRef}
          rows={1}
          placeholder="Напишите сообщение… (@ — вставить сущность)"
          value={draft}
          onChange={setDraft}
          onEnter={() => submit({ preventDefault() {} })}
          mentions={(mentions ?? []).map((m) => ({ title: m.title, type: m.type }))}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>Отправить</button>
      </form>
    </section>
  );
}

// Предложения ИИ — в правой колонке, рядом с «Недавно созданными».
export function WorkshopProposals() {
  const { proposals, approve, reject } = useWorkshopChat();
  if (proposals.length === 0) return null;
  return (
    <aside className="panel">
      <div className="proposals-head">
        <h3>Предложения</h3>
        {proposals.length > 1 && (
          <div className="proposals-bulk">
            <button type="button" className="bulk-accept" onClick={() => proposals.forEach((p) => approve(p.id))}>Принять все</button>
            <button type="button" className="bulk-reject" onClick={() => proposals.forEach((p) => reject(p.id))}>Отклонить все</button>
          </div>
        )}
      </div>
      <div className="proposals">
        {proposals.map((p) => (
          <div key={p.id} className="proposal">
            <div className="proposal-head">
              {p.action === "update" && <span className="proposal-tag-update">Изменить</span>}
              <strong>{p.title}</strong> <TypeTag type={p.type} />
            </div>
            <div className="proposal-body"><Markdown>{p.content}</Markdown></div>
            <div className="proposal-actions">
              <button type="button" onClick={() => approve(p.id)}>{p.action === "update" ? "Обновить" : "Принять"}</button>
              <button type="button" onClick={() => reject(p.id)}>Отклонить</button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
