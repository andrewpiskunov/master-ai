import { useEffect, useRef, useState } from "react";
import type { Proposal } from "@master-ai/shared";
import { Globe, RefreshCw, MessageCircle, Check, X, Plus, FileUp, Square } from "lucide-react";
import { ImageAttachments, MessageImages } from "../images/ImageAttachments.js";
import { Markdown } from "../../ui/Markdown.js";
import { Modal } from "../../ui/Modal.js";
import { MentionTextarea } from "../../ui/MentionTextarea.js";
import type { MentionItem } from "../../lib/mentions.js";
import { useWorkshopChat } from "./WorkshopChatContext.js";
import { TypeTag, TypeBadge } from "../campaigns/shared.js";

// Короткое описание предложения для карточки: берём первое значимое значение поля
// или первый абзац, без markdown-разметки.
function snippet(md: string): string {
  const strip = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/\s+/g, " ").trim();
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const field = /^[-*]\s*\*\*[^*]+\*\*\s*:?\s*(.+)$/.exec(l);
    if (field?.[1]) return clip(strip(field[1]));
    const item = /^[-*]\s+(.+)$/.exec(l);
    if (item?.[1] && !/\*\*[^*]+\*\*\s*:?\s*$/.test(l)) return clip(strip(item[1]));
    if (!l.startsWith("-") && !/^\d+\./.test(l)) return clip(strip(l));
  }
  return clip(strip(md));
}
function clip(s: string): string {
  return s.length > 150 ? `${s.slice(0, 150).trimEnd()}…` : s;
}

export function WorkshopPanel({ mentions }: { mentions?: MentionItem[] }) {
  const { messages, busy, awaitingWelcome, send, stop, draft, setDraft, images } = useWorkshopChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const [importing, setImporting] = useState(false);
  const [source, setSource] = useState("");

  function submitImport() {
    const text = source.trim();
    if (!text || busy) return;
    send(`Вот исходный материал кампании (модуль, заметки, выдержки). Извлеки из него ключевые сущности — NPC, локации, фракции, секреты, сцены, арки — и оформи их документами. Сохраняй имена и факты из текста.\n\n---\n${text}`, false);
    setSource("");
    setImporting(false);
  }

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
    if ((!text && !images.items.length) || busy || images.reading) return;
    send(text);
  }

  return (
    <section className="workshop">
      <div className="workshop-bar">
        <button type="button" className="import-btn" onClick={() => setImporting(true)}>
          <FileUp size={14} strokeWidth={1.9} /> Импорт материала
        </button>
      </div>
      <div className="chat" ref={chatRef}>
        {messages.length === 0 && !busy && !awaitingWelcome && (
          <p className="chat-empty">Опишите идею кампании — ИИ ответит и предложит документы.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "Вы" : "ИИ"}</div>
            <Markdown mentions={mentions}>{m.content}</Markdown>
            <MessageImages images={m.meta?.images} />
          </div>
        ))}
        {(busy || awaitingWelcome) && (
          <div className="msg msg-assistant">
            <div className="msg-role">ИИ</div>
            <div className="typing" aria-label="ИИ печатает">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <ImageAttachments draft={images} disabled={busy} />
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
          onPaste={images.onPaste}
        />
        {busy ? (
          <button type="button" className="chat-send chat-stop" onClick={stop} title="Остановить генерацию — набранный текст останется">
            <Square size={13} strokeWidth={2.2} /> Стоп
          </button>
        ) : (
          <button type="submit" disabled={images.reading}>Отправить</button>
        )}
      </form>

      {importing && (
        <Modal title="Импорт материала" onClose={() => setImporting(false)}>
          <p className="muted import-hint">
            Вставьте исходник — модуль, свои заметки или выдержки с другого сайта. ИИ разберёт текст
            и предложит документы (NPC, локации, фракции, секреты, сцены, арки), сохраняя имена и факты.
          </p>
          <label htmlFor="import-src" className="sr-only">Исходный материал</label>
          <textarea
            id="import-src"
            className="import-textarea"
            rows={10}
            autoFocus
            placeholder="Вставьте сюда текст модуля или заметок…"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <div className="modal-actions">
            <button type="button" onClick={submitImport} disabled={!source.trim() || busy}>Разобрать материал</button>
            <button type="button" className="btn-ghost" onClick={() => setImporting(false)}>Отмена</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

// «Мир пока что» — живая сводка кампании по беседе + текущий ключевой вопрос.
export function WorldSummary() {
  const { world, worldBusy, refreshWorld, messages } = useWorkshopChat();
  if (messages.length < 2 && !world) return null;
  return (
    <section className="panel world-panel">
      <div className="world-head">
        <h3><Globe size={16} strokeWidth={1.9} /> Мир кампании</h3>
        <button type="button" className="world-refresh" onClick={refreshWorld} disabled={worldBusy} title="Обновить сводку">
          <RefreshCw size={14} className={worldBusy ? "spin" : ""} />
        </button>
      </div>
      {worldBusy && !world ? (
        <p className="muted">Собираю сводку мира…</p>
      ) : world?.summary ? (
        <>
          <p className="world-summary">{world.summary}</p>
          {world.question && <div className="world-question"><MessageCircle size={14} /> <span>{world.question}</span></div>}
        </>
      ) : (
        <p className="muted">Сводка появится по мере беседы — нажмите «обновить».</p>
      )}
    </section>
  );
}

// Предложения ИИ — в правой колонке, рядом с «Недавно созданными».
export function WorkshopProposals() {
  const { proposals, approve, reject } = useWorkshopChat();
  const [preview, setPreview] = useState<Proposal | null>(null);
  if (proposals.length === 0) return null;
  return (
    <aside className="panel">
      <div className="proposals-head">
        <h3>Предложения</h3>
        {proposals.length > 1 && (
          <div className="proposals-bulk">
            <button type="button" className="bulk-accept" onClick={() => proposals.forEach((p) => approve(p.id))}><Plus size={14} strokeWidth={2.4} /> Принять все</button>
            <button type="button" className="bulk-reject" onClick={() => proposals.forEach((p) => reject(p.id))}>Отклонить все</button>
          </div>
        )}
      </div>
      <div className="proposals">
        {proposals.map((p) => (
          <div key={p.id} className="proposal">
            <span className="proposal-icon"><TypeBadge type={p.type} size={26} /></span>
            <div
              className="proposal-main"
              role="button"
              tabIndex={0}
              title="Посмотреть полностью"
              onClick={() => setPreview(p)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPreview(p); } }}
            >
              <span className="proposal-title">{p.title}</span>
              <div className="proposal-meta">
                <TypeTag type={p.type} />
                {p.action === "update" && <span className="proposal-tag-update">Изменить</span>}
              </div>
              <p className="proposal-snippet">{snippet(p.content)}</p>
            </div>
            <div className="proposal-actions">
              <button type="button" className="prop-accept" title={p.action === "update" ? `Обновить «${p.title}»` : `Принять «${p.title}»`} onClick={() => approve(p.id)}>
                <Check size={16} strokeWidth={2.2} />
              </button>
              <button type="button" className="prop-reject" title="Отклонить" onClick={() => reject(p.id)}>
                <X size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {preview && (
        <Modal title={preview.title} className="modal-proposal" onClose={() => setPreview(null)}>
          <div className="proposal-preview-meta">
            <TypeTag type={preview.type} />
            {preview.action === "update" && <span className="proposal-tag-update">Изменить существующий документ</span>}
          </div>
          <div className="proposal-preview-body">
            <Markdown>{preview.content}</Markdown>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={() => { approve(preview.id); setPreview(null); }}>
              {preview.action === "update" ? "Обновить документ" : "Принять"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { reject(preview.id); setPreview(null); }}>Отклонить</button>
            <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>Закрыть</button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
