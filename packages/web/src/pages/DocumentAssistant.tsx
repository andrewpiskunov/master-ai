import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, Plus } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType } from "@master-ai/shared";
import { streamComplete } from "../api/stream.js";
import { Markdown } from "../ui/Markdown.js";
import { useToast } from "../ui/toast.js";
import { TypeTag } from "./campaign/shared.js";

interface Msg { role: "user" | "assistant"; content: string }
export interface NewEntity { type: string; title: string; text: string }

// Беседы по документам переживают переключение между карточками в рамках сессии.
const chatCache = new Map<string, Msg[]>();

// Разбирает блок ```new-doc … ``` с предложением создать новую сущность.
function parseNewDoc(block: string): NewEntity | null {
  const typeM = /^\s*type:\s*([^\s]+)/im.exec(block);
  const titleM = /^\s*title:\s*(.+)$/im.exec(block);
  if (!typeM || !titleM) return null;
  const sep = block.indexOf("---");
  const text = sep >= 0
    ? block.slice(sep + 3).trim()
    : block.replace(/^\s*type:.*$/im, "").replace(/^\s*title:.*$/im, "").trim();
  return { type: typeM[1].trim(), title: titleM[1].trim().replace(/^[«"']|[»"']$/g, ""), text };
}

// Выделяет из ответа ИИ: правку текущего документа (```doc), предложение новой
// сущности (```new-doc) и вводный текст вне блоков.
function parseAssistant(content: string): { intro: string; doc: string | null; newDoc: NewEntity | null } {
  const newClosed = /```new-doc\s*\n([\s\S]*?)```/.exec(content);
  if (newClosed) {
    return { intro: content.replace(newClosed[0], "").trim(), doc: null, newDoc: parseNewDoc(newClosed[1]) };
  }
  if (content.includes("```new-doc")) {
    // блок ещё не закрыт — прячем «хвост», карточку покажем после завершения
    return { intro: content.slice(0, content.indexOf("```new-doc")).trim(), doc: null, newDoc: null };
  }
  const closed = /```doc\s*\n([\s\S]*?)```/.exec(content);
  if (closed) return { intro: content.replace(closed[0], "").trim(), doc: closed[1].trim(), newDoc: null };
  const open = content.indexOf("```doc");
  if (open >= 0) return { intro: content.slice(0, open).trim(), doc: null, newDoc: null };
  return { intro: content, doc: null, newDoc: null };
}

const TYPE_LIST = DOCUMENT_TYPES.map((t) => `${t.key} (${t.label})`).join(", ");

export function DocumentAssistant({
  docId,
  title,
  typeLabel,
  getText,
  onApply,
  onCreateEntity,
}: {
  docId: string;
  title: string;
  typeLabel: string;
  getText: () => string;
  onApply: (text: string) => void;
  onCreateEntity: (entity: NewEntity) => void;
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
            `Когда пользователь просит изменить, переписать или дополнить ЭТОТ документ — верни ПОЛНУЮ новую версию ` +
            `текста документа внутри блока \`\`\`doc и \`\`\` (обычный текст; при необходимости «## Заголовок», списки «- »). ` +
            `Вне блока коротко, по-русски, поясни, что изменил.\n\n` +
            `Когда пользователь просит СОЗДАТЬ новую сущность (например «сделай из этой заметки персонажа», ` +
            `«создай NPC», «добавь локацию») — НЕ переписывай текущий документ. Вместо этого предложи новую сущность ` +
            `блоком \`\`\`new-doc и \`\`\` строго в формате:\n` +
            `type: <ключ типа из списка>\ntitle: <короткое название, 1–3 слова, без кавычек>\n---\n<описание сущности обычным текстом>\n` +
            `Доступные типы: ${TYPE_LIST}. Для персонажа игрока используй pc, для прочих персонажей — npc. ` +
            `Вне блока коротко поясни, что предлагаешь создать.\n\n` +
            `Если правка не нужна — отвечай обычным текстом без блоков.`,
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
          const { intro, doc, newDoc } = parseAssistant(m.content);
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
                    {newDoc && (
                      <div className="apply-card">
                        <div className="apply-head">
                          <TypeTag type={newDoc.type} />
                          <span className="apply-new-title">{newDoc.title}</span>
                        </div>
                        {newDoc.text && <div className="apply-preview">{newDoc.text}</div>}
                        <button type="button" className="apply-btn" onClick={() => onCreateEntity(newDoc)}>
                          <Plus size={15} /> Создать сущность «{newDoc.title}»
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
