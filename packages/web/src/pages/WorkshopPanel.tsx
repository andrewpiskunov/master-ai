import { useEffect, useState, type FormEvent } from "react";
import type { ConversationMessage, Proposal } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";
import { Markdown } from "../ui/Markdown.js";

export function WorkshopPanel({ campaignId, onApproved }: { campaignId: string; onApproved: () => void }) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConversation(campaignId).then(setMessages).catch(() => showToast("Не удалось загрузить беседу"));
    api.listProposals(campaignId, "pending").then(setProposals).catch(() => showToast("Не удалось загрузить предложения"));
  }, [campaignId, showToast]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    // Сразу показываем сообщение пользователя и индикатор «печатает».
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() },
    ]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.brainstorm(campaignId, text);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content: res.reply, createdAt: new Date().toISOString() },
      ]);
      setProposals((prev) => [...prev, ...res.proposals]);
    } catch {
      showToast("Не удалось получить ответ ИИ");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    try {
      await api.approveProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
      onApproved();
    } catch {
      showToast("Не удалось принять предложение");
    }
  }

  async function reject(id: string) {
    try {
      await api.rejectProposal(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } catch {
      showToast("Не удалось отклонить предложение");
    }
  }

  return (
    <section className="workshop">
      <div className="chat">
        {messages.length === 0 && !busy && (
          <p className="chat-empty">Опишите идею кампании — ИИ ответит и предложит документы.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "Вы" : "ИИ"}</div>
            <Markdown>{m.content}</Markdown>
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

      <form className="chat-form" onSubmit={send}>
        <label htmlFor="brainstorm-input" className="sr-only">Сообщение</label>
        <input
          id="brainstorm-input"
          placeholder="Напишите сообщение…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>Отправить</button>
      </form>

      {proposals.length > 0 && (
        <div className="proposals">
          <h3>Предложения</h3>
          {proposals.map((p) => (
            <div key={p.id} className="proposal">
              <div className="proposal-head">
                <strong>{p.title}</strong> <em>{p.type}</em>
              </div>
              <div className="proposal-body"><Markdown>{p.content}</Markdown></div>
              <div className="proposal-actions">
                <button type="button" onClick={() => approve(p.id)}>Принять</button>
                <button type="button" onClick={() => reject(p.id)}>Отклонить</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
