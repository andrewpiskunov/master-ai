import { useEffect, useState, type FormEvent } from "react";
import type { ConversationMessage, Proposal } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";

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
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.brainstorm(campaignId, input.trim());
      setMessages((prev) => [
        ...prev,
        { id: `reply-${Date.now()}`, role: "assistant", content: res.reply, createdAt: new Date().toISOString() },
      ]);
      setProposals((prev) => [...prev, ...res.proposals]);
      setInput("");
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
      <h2>Мастерская</h2>
      <div className="chat">
        {messages.map((m) => (
          <p key={m.id}><strong>{m.role === "user" ? "Вы" : "ИИ"}:</strong> {m.content}</p>
        ))}
      </div>
      <form onSubmit={send}>
        <label htmlFor="brainstorm-input">Сообщение</label>
        <input id="brainstorm-input" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={busy}>Отправить</button>
      </form>

      {proposals.length > 0 && (
        <div className="proposals">
          <h3>Предложения</h3>
          {proposals.map((p) => (
            <div key={p.id} className="proposal">
              <strong>{p.title}</strong> <em>({p.type})</em>
              <p>{p.content}</p>
              <button type="button" onClick={() => approve(p.id)}>Принять</button>
              <button type="button" onClick={() => reject(p.id)}>Отклонить</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
