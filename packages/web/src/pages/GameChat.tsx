import { useEffect, useRef, useState } from "react";
import { BookOpen, Lock, Plus, Send, Square, Star, User } from "lucide-react";
import { dedupeGameTail, extractLogBlock, parseGameSections, type MessageMeta } from "@master-ai/shared";
import { api } from "../api/client.js";
import { Markdown } from "../ui/Markdown.js";
import { MentionTextarea } from "../ui/MentionTextarea.js";
import { useToast } from "../ui/toast.js";
import { AssistantAnswer } from "./AssistantAnswer.js";
import type { EditEntity, NewEntity } from "./assistant-blocks.js";
import type { MentionItem } from "../mentions.js";

export interface Actor { kind: "pc" | "npc" | "master"; id: string | null; name: string }
export interface GameMsg { id?: string; role: "user" | "assistant"; content: string; createdAt?: string; meta?: MessageMeta }

const MASTER: Actor = { kind: "master", id: null, name: "Мастер" };

// Состояние игрового чата: живёт в PlaySession, чтобы лог-панель в правой
// колонке строилась из тех же сообщений (один источник правды).
export function useGameChat(docId: string, onAssistantMessage?: (content: string) => void) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<GameMsg[]>([]);
  const [busy, setBusy] = useState(false);
  // Токен активного опроса: новый запуск или смена документа гасят старый цикл.
  const pollTokenRef = useRef(0);

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
          setMessages(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, meta: m.meta })));
          const last = msgs[msgs.length - 1];
          if (notify && last?.role === "assistant") onAssistantMessage?.(last.content);
        } else {
          // Сервер недоступен: убираем пустую заглушку ответа, чтобы не висел вечный «печатает».
          setMessages((prev) => (prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1].content ? prev.slice(0, -1) : prev));
        }
        setBusy(false);
        return;
      }
      await new Promise((r) => setTimeout(r, 1200));
      if (token !== pollTokenRef.current) return;
    }
  }

  // История беседы сессии хранится на сервере; идущую генерацию подхватываем.
  useEffect(() => {
    let cancelled = false;
    api.getDocumentConversation(docId)
      .then(async (msgs) => {
        if (cancelled) return;
        setMessages(msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, meta: m.meta })));
        const st = await api.assistantStatus(docId).catch(() => null);
        if (cancelled || !st?.running) return;
        setMessages((prev) => [...prev, { role: "assistant", content: st.partial }]);
        setBusy(true);
        void pollJob(true);
      })
      .catch(() => {});
    return () => { cancelled = true; pollTokenRef.current++; };
  // pollJob намеренно вне зависимостей: пересоздаётся каждый рендер, цикл держится за токен
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  async function send(text: string, actor: Actor, system: string) {
    const t = text.trim();
    if (!t || busy) return;
    const meta: MessageMeta = actor.kind === "master"
      ? { actorKind: "master", actorName: "Мастер" }
      : { actorKind: actor.kind, actorName: actor.name, actorId: actor.id ?? undefined };
    setMessages((prev) => [...prev, { role: "user", content: t, meta }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await api.startAssistant(docId, t, system, { mode: "game", meta });
      await pollJob(true);
    } catch {
      showToast("Не удалось запустить генерацию");
      setMessages((prev) => prev.slice(0, -2)); // откат оптимистичной пары
      setBusy(false);
    }
  }

  function stop() { void api.stopAssistant(docId); }

  // Переключить важность записи лога (звезда в лог-панели).
  async function toggleImportant(messageId: string) {
    const m = messages.find((x) => x.id === messageId);
    const log = m?.meta?.log;
    if (!log) return;
    try {
      const updated = await api.updateMessageMeta(messageId, { log: { ...log, important: !log.important } });
      setMessages((prev) => prev.map((x) => (x.id === messageId ? { ...x, meta: updated.meta } : x)));
    } catch {
      showToast("Не удалось обновить запись лога");
    }
  }

  return { messages, busy, send, stop, toggleImportant };
}
export type GameChatState = ReturnType<typeof useGameChat>;

// Центральная колонка режима игры: лента чата с ИИ-мастером, чипы акторов, поле ввода.
export function GameChat({
  docId, chat, pcs, npcs, documents, buildSystem, playerView,
  currentText, appliedBlocks, docUpdatedAt, onApply, onCreateEntity, onEditEntity,
  mentions, onMentionClick,
}: {
  docId: string;
  chat: GameChatState;
  pcs: { id: string; title: string }[];
  npcs: { id: string; title: string }[];
  documents: { title: string; type: string }[];
  buildSystem: () => string;
  playerView: boolean;
  currentText: string;
  appliedBlocks: string[];
  docUpdatedAt?: string;
  onApply: (text: string) => void;
  onCreateEntity: (entity: NewEntity) => void;
  onEditEntity: (edit: EditEntity) => void;
  // Сущности кампании для подсветки в ленте (пилюли, как в Мастерской); href = id документа.
  mentions?: MentionItem[];
  // Клик по пилюле — открыть документ (например, во вкладке «Документы»).
  onMentionClick?: (docId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [actor, setActor] = useState<Actor>(MASTER);
  // NPC, добавленные чипами на время сессии (в память — «временные» по спеке).
  const [extraNpcs, setExtraNpcs] = useState<{ id: string; title: string }[]>([]);

  // Сброс временных NPC-чипов и выбранного актора при смене документа.
  useEffect(() => { setExtraNpcs([]); setActor(MASTER); }, [docId]);
  const [npcOpen, setNpcOpen] = useState(false);
  const [npcQuery, setNpcQuery] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.busy]);

  function submit() {
    const text = input.trim();
    if (!text || chat.busy) return;
    setInput("");
    void chat.send(text, actor, buildSystem());
  }

  // Сообщение «устарело», если документ сессии сохранялся после него (как в помощнике).
  const isStale = (m: GameMsg): boolean => {
    if (!docUpdatedAt || !m.createdAt) return false;
    const mt = Date.parse(m.createdAt);
    const dt = Date.parse(docUpdatedAt);
    return Number.isFinite(mt) && Number.isFinite(dt) && mt < dt;
  };

  const q = npcQuery.trim().toLowerCase();
  const npcResults = (q ? npcs.filter((n) => n.title.toLowerCase().includes(q)) : npcs).slice(0, 8);

  // Пилюли сущностей показываем только мастеру («Всё видно») — в показе игрокам они выдают структуру кампании.
  const feedMentions = playerView ? undefined : mentions;

  return (
    <div className="game-chat">
      <div
        className="chat game-feed"
        ref={feedRef}
        onClick={(e) => {
          // Пилюля — <a href="<id документа>">: не даём браузеру перейти по «ссылке», открываем в просмотрщике.
          const a = (e.target as HTMLElement).closest("a.mention") as HTMLAnchorElement | null;
          if (!a) return;
          e.preventDefault();
          const id = a.getAttribute("href");
          if (id && onMentionClick) onMentionClick(id);
        }}
      >
        {chat.messages.length === 0 && !chat.busy && (
          <p className="chat-empty">Выберите персонажа и опишите его действие — ИИ-мастер ответит. Чип «Мастер» — для вопросов без привязки к персонажу.</p>
        )}
        {chat.messages.map((m, i) => m.role === "user" ? (
          <div key={m.id ?? `i${i}`} className="msg gmsg-user" data-msg-id={m.id}>
            <div className="msg-role">{m.meta?.actorName ?? "Мастер"}</div>
            <Markdown mentions={feedMentions}>{m.content}</Markdown>
          </div>
        ) : (
          <div key={m.id ?? `i${i}`} className="msg gmsg-ai" data-msg-id={m.id}>
            <div className="msg-role">ИИ-мастер</div>
            {m.content ? (() => {
              // По контракту log-блок завершает ответ; если модель дописала сцену после него,
              // показываем хвост обычным текстом — он не «скрытое» и не должен краситься жёлтым.
              // Абзацы хвоста, дословно повторяющие уже показанный текст, отбрасываем.
              const parts = extractLogBlock(m.content);
              const rest = parts.rest;
              const after = dedupeGameTail(parts.after, parts.rest);
              return (
              <>
              <AssistantAnswer
                content={rest}
                stale={isStale(m)}
                currentText={currentText}
                appliedBlocks={appliedBlocks}
                documents={documents}
                onApply={onApply}
                onCreateEntity={onCreateEntity}
                onEditEntity={onEditEntity}
                renderIntro={(intro) => {
                  const s = parseGameSections(intro);
                  // Модель может продублировать сцену внутри «Скрытого» — вычищаем повторы.
                  const hidden = s.hidden ? dedupeGameTail(s.hidden, [s.intro, s.read].filter(Boolean).join("\n")) : null;
                  return (
                    <>
                      {s.intro && <Markdown mentions={feedMentions}>{s.intro}</Markdown>}
                      {s.read && (
                        <div className="game-read">
                          <div className="game-block-head"><BookOpen size={14} /> Прочитай игрокам</div>
                          <Markdown mentions={feedMentions}>{s.read}</Markdown>
                        </div>
                      )}
                      {hidden && !playerView && (
                        <div className="game-hidden">
                          <div className="game-block-head"><Lock size={14} /> Скрытое для мастера</div>
                          <Markdown mentions={feedMentions}>{hidden}</Markdown>
                        </div>
                      )}
                    </>
                  );
                }}
              />
              {after && <Markdown mentions={feedMentions}>{after}</Markdown>}
              </>
              );
            })() : (
              <div className="typing" aria-label="ИИ печатает"><span></span><span></span><span></span></div>
            )}
          </div>
        ))}
      </div>

      <div className="game-actors">
        {pcs.map((p) => (
          <button key={p.id} type="button" className={`actor-chip${actor.id === p.id ? " active" : ""}`}
            onClick={() => setActor({ kind: "pc", id: p.id, name: p.title })}>{p.title}</button>
        ))}
        {extraNpcs.map((n) => (
          <button key={n.id} type="button" className={`actor-chip actor-chip-npc${actor.id === n.id ? " active" : ""}`}
            onClick={() => setActor({ kind: "npc", id: n.id, name: n.title })}>{n.title}</button>
        ))}
        <div className="actor-npc">
          <button type="button" className="actor-chip actor-add" onClick={() => setNpcOpen((v) => !v)}><Plus size={13} /> NPC</button>
          {npcOpen && (
            <div className="actor-npc-pop">
              <input autoFocus placeholder="Найти NPC…" value={npcQuery} onChange={(e) => setNpcQuery(e.target.value)} />
              <div className="actor-npc-list">
                {npcResults.map((n) => (
                  <button key={n.id} type="button" onClick={() => {
                    setExtraNpcs((prev) => (prev.some((x) => x.id === n.id) ? prev : [...prev, n]));
                    setActor({ kind: "npc", id: n.id, name: n.title });
                    setNpcOpen(false);
                    setNpcQuery("");
                  }}>{n.title}</button>
                ))}
                {!npcResults.length && <p className="muted">Не найдено</p>}
              </div>
            </div>
          )}
        </div>
        <button type="button" className={`actor-chip actor-master${actor.kind === "master" ? " active" : ""}`}
          onClick={() => setActor(MASTER)}><User size={13} /> Мастер</button>
      </div>

      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="game-chat-input" className="sr-only">Сообщение ИИ-мастеру</label>
        <MentionTextarea
          id="game-chat-input"
          ref={textareaRef}
          rows={2}
          placeholder={actor.kind === "master" ? "Спросите ИИ-мастера… (@ — вставить сущность)" : `Что делает ${actor.name}? (@ — вставить сущность)`}
          value={input}
          onChange={setInput}
          onEnter={submit}
          mentions={documents}
          disabled={chat.busy}
        />
        {chat.busy ? (
          <button type="button" className="chat-send chat-stop" onClick={chat.stop} title="Остановить генерацию — набранный текст останется">
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

// Лог событий (правая колонка): производная от сообщений с meta.log.
export function GameLogPanel({ messages, onJump, onToggleImportant }: {
  messages: GameMsg[];
  onJump: (messageId: string) => void;
  onToggleImportant: (messageId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const entries = messages.filter(
    (m): m is GameMsg & { id: string; meta: { log: { title: string; important: boolean } } } =>
      m.role === "assistant" && !!m.id && !!m.meta?.log,
  );
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <div className="game-log">
      <div className="game-log-head">Лог событий</div>
      <div className="game-log-list" ref={listRef}>
        {entries.length === 0 && <p className="muted game-log-empty">Действия персонажей будут появляться здесь.</p>}
        {entries.map((m) => (
          <div key={m.id} className={`game-log-item${m.meta.log.important ? " important" : ""}`}>
            <button type="button" className="game-log-star" onClick={() => onToggleImportant(m.id)}
              title={m.meta.log.important ? "Снять пометку важного" : "Пометить важным"}>
              <Star size={13} fill={m.meta.log.important ? "currentColor" : "none"} />
            </button>
            <button type="button" className="game-log-title" onClick={() => onJump(m.id)} title="Показать в чате">
              {m.meta.log.title}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
