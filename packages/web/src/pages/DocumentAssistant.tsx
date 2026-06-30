import { useEffect, useRef, useState } from "react";
import { Check, Plus, Send, Pencil } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType } from "@master-ai/shared";
import { streamComplete } from "../api/stream.js";
import { Markdown } from "../ui/Markdown.js";
import { MentionTextarea } from "../ui/MentionTextarea.js";
import { useToast } from "../ui/toast.js";
import { TypeTag } from "./campaign/shared.js";

interface Msg { role: "user" | "assistant"; content: string }
export interface NewEntity { type: string; title: string; text: string }
export interface EditEntity { title: string; rename?: string; text?: string }

const dequote = (s: string) => s.trim().replace(/^[«"']|[»"']$/g, "");

// Разбирает блоки ```edit-doc … ``` — изменение существующих документов (переименование/правка).
function parseEdits(content: string): { edits: EditEntity[]; rest: string } {
  const edits: EditEntity[] = [];
  let rest = content;
  const re = /```edit-doc\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const block = m[1];
    const titleM = /^\s*title:\s*(.+)$/im.exec(block);
    if (!titleM) continue;
    const renameM = /^\s*rename:\s*(.+)$/im.exec(block);
    const sep = block.indexOf("---");
    const text = sep >= 0 ? block.slice(sep + 3).trim() : "";
    edits.push({ title: dequote(titleM[1]), rename: renameM ? dequote(renameM[1]) : undefined, text: text || undefined });
    rest = rest.replace(m[0], "");
  }
  return { edits, rest };
}

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

// Выделяет из ответа ИИ: правки существующих документов (```edit-doc), правку
// текущего документа (```doc), предложение новой сущности (```new-doc) и вводный текст.
function parseAssistant(content: string): { intro: string; doc: string | null; newDoc: NewEntity | null; edits: EditEntity[] } {
  const { edits, rest } = parseEdits(content);
  // незакрытый блок edit-doc во время стрима — прячем хвост
  let work = rest;
  const openEdit = work.indexOf("```edit-doc");
  if (openEdit >= 0) work = work.slice(0, openEdit);

  const newClosed = /```new-doc\s*\n([\s\S]*?)```/.exec(work);
  if (newClosed) {
    return { intro: work.replace(newClosed[0], "").trim(), doc: null, newDoc: parseNewDoc(newClosed[1]), edits };
  }
  if (work.includes("```new-doc")) {
    return { intro: work.slice(0, work.indexOf("```new-doc")).trim(), doc: null, newDoc: null, edits };
  }
  const closed = /```doc\s*\n([\s\S]*?)```/.exec(work);
  if (closed) return { intro: work.replace(closed[0], "").trim(), doc: closed[1].trim(), newDoc: null, edits };
  const open = work.indexOf("```doc");
  if (open >= 0) return { intro: work.slice(0, open).trim(), doc: null, newDoc: null, edits };
  return { intro: work.trim(), doc: null, newDoc: null, edits };
}

const TYPE_LIST = DOCUMENT_TYPES.map((t) => `${t.key} (${t.label})`).join(", ");

export function DocumentAssistant({
  docId,
  title,
  typeLabel,
  template,
  documents,
  campaignBrief,
  getText,
  onApply,
  onCreateEntity,
  onEditEntity,
}: {
  docId: string;
  title: string;
  typeLabel: string;
  template?: string;
  documents: { title: string; type: string }[];
  campaignBrief?: string;
  getText: () => string;
  onApply: (text: string) => void;
  onCreateEntity: (entity: NewEntity) => void;
  onEditEntity: (edit: EditEntity) => void;
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
            `Когда пользователь просит СОЗДАТЬ новую сущность (например «сделай из этой заметки персонажа», ` +
            `«создай NPC», «добавь локацию») — НЕ переписывай текущий документ. Вместо этого предложи новую сущность ` +
            `блоком \`\`\`new-doc и \`\`\` строго в формате:\n` +
            `type: <ключ типа из списка>\ntitle: <короткое название, 1–3 слова, без кавычек>\n---\n<описание сущности обычным текстом>\n` +
            `Доступные типы: ${TYPE_LIST}. Для персонажа игрока используй pc, для прочих персонажей — npc. ` +
            `Для npc и pc давай полное имя — имя и фамилию (или родовое прозвище), а не одно голое имя: «Гаст Двукоготь», а не «Гаст». ` +
            `Вне блока коротко поясни, что предлагаешь создать.\n\n` +
            `Когда пользователь просит ИЗМЕНИТЬ, ПЕРЕИМЕНОВАТЬ или ОБНОВИТЬ уже существующие документы ` +
            `(например «добавь всем NPC фамилии», «переименуй X», «обнови описание Y») — НЕ создавай новые. ` +
            `Для КАЖДОГО изменяемого документа верни отдельный блок \`\`\`edit-doc и \`\`\` строго в формате:\n` +
            `title: <точное название существующего документа из списка ниже>\nrename: <новое название> (только если меняешь имя)\n---\n<полный новый текст документа> (только если меняешь содержимое; иначе оставь пустым)\n` +
            `Можно вернуть несколько блоков edit-doc подряд. Существующие документы кампании: ` +
            `${documents.slice(0, 100).map((d) => `«${d.title}» (${getDocumentType(d.type)?.label ?? d.type})`).join(", ") || "(пока нет)"}.\n\n` +
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
          const { intro, doc, newDoc, edits } = parseAssistant(m.content);
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
                    {edits.map((e, ei) => (
                      <div className="apply-card" key={ei}>
                        <div className="apply-head">
                          <Pencil size={14} />
                          <span className="apply-new-title">{e.title}{e.rename ? ` → ${e.rename}` : ""}</span>
                        </div>
                        {e.text && <div className="apply-preview">{e.text}</div>}
                        <button type="button" className="apply-btn" onClick={() => onEditEntity(e)}>
                          <Check size={15} /> Обновить «{e.rename ?? e.title}»
                        </button>
                      </div>
                    ))}
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
        <button type="submit" className="chat-send" disabled={busy} title="Отправить">
          <Send size={15} strokeWidth={1.9} /> <span>Отправить</span>
        </button>
      </form>
    </div>
  );
}
