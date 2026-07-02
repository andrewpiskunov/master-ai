import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X, ArrowLeft, ArrowRight, Pin, Eye, EyeOff } from "lucide-react";
import type { Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { streamComplete } from "../api/stream.js";
import { useToast } from "../ui/toast.js";
import { Markdown } from "../ui/Markdown.js";
import { contentToHtml } from "../editor/contentToHtml.js";
import { pmText } from "../prosemirror-text.js";
import { markdownToDoc } from "../editor/DocumentEditor.js";
import { blockKey, entityBlocksPrompt, parseAssistant, type NewEntity } from "./assistant-blocks.js";
import { CombatTracker, type CombatState } from "./CombatTracker.js";
import { TypeTag, TypeBadge } from "./campaign/shared.js";
import { prepareMentions, matchMentions, type MentionItem } from "../mentions.js";
import { GameChat, GameLogPanel, useGameChat, type GameMsg } from "./GameChat.js";

// Делает названия упоминаемых документов кликабельными прямо в тексте сессии.
function linkifyMentions(container: HTMLElement, prepared: MentionItem[]) {
  if (!prepared.length) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.textContent ?? "";
    if (!text.trim() || (node.parentElement && node.parentElement.closest("a"))) continue;
    const spans = matchMentions(text, prepared);
    if (!spans.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const s of spans) {
      if (s.start > last) frag.appendChild(document.createTextNode(text.slice(last, s.start)));
      const a = document.createElement("a");
      a.className = `mention mention-${s.type} play-link`;
      a.dataset.docId = s.href ?? "";
      // Несколько документов с одним названием: клик переключает их по кругу.
      if (s.hrefs && s.hrefs.length > 1) {
        a.dataset.docIds = s.hrefs.join(",");
        a.classList.add("mention-ambiguous");
        a.title = `Документов с этим названием: ${s.hrefs.length} — клик переключает`;
      }
      a.textContent = text.slice(s.start, s.end);
      frag.appendChild(a);
      last = s.end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

// Делит документ на секции по заголовкам 2-го уровня — чтобы прятать/показывать их по отдельности.
function splitSections(content: unknown): { heading: string | null; doc: unknown }[] {
  const c = content as { content?: { type?: string; attrs?: { level?: number } }[] } | null;
  const nodes = c && Array.isArray(c.content) ? c.content : [];
  const groups: { heading: string | null; nodes: unknown[] }[] = [];
  let cur: { heading: string | null; nodes: unknown[] } = { heading: null, nodes: [] };
  for (const n of nodes) {
    if (n?.type === "heading" && n.attrs?.level === 2) {
      if (cur.nodes.length) groups.push(cur);
      cur = { heading: pmText(n).trim(), nodes: [n] };
    } else {
      cur.nodes.push(n);
    }
  }
  if (cur.nodes.length) groups.push(cur);
  return groups.map((g) => ({ heading: g.heading, doc: { type: "doc", content: g.nodes } }));
}

// Разбор JSON со списком участников боя из ответа ИИ (терпим к обрамлению).
function parseCombatants(text: string): { name: string; init: number; hp: number }[] {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fence ? fence[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { combatants?: unknown[] };
    const arr = Array.isArray(parsed.combatants) ? parsed.combatants : [];
    return arr
      .filter((x): x is { name: string } => !!x && typeof (x as { name?: unknown }).name === "string")
      .map((x) => ({
        name: String(x.name).trim(),
        init: Number((x as { init?: unknown }).init) || 0,
        hp: Number((x as { hp?: unknown }).hp) || 10,
      }))
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

// Режим прогона сессии за столом: игровой чат с ИИ-мастером, просмотрщик документов, лог и бой.
export function PlaySession() {
  const { campaignId, documentId } = useParams<{ campaignId: string; documentId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [doc, setDoc] = useState<Document | null>(null);
  // Единый писатель полей документа: читает всегда свежий ref, поэтому лог, пины
  // и прочее не затирают друг друга (fields сохраняется целиком).
  const docRef = useRef<Document | null>(null);
  docRef.current = doc;
  const [docs, setDocs] = useState<Document[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [tab, setTab] = useState<"scenario" | "docs" | "combat">("scenario");
  const contentRef = useRef<HTMLDivElement>(null);
  // История просмотрщика связанных документов.
  const [view, setView] = useState<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  // Предлагаемые ассистентом к созданию сущности (документа ещё нет в базе) — по синтетическому id.
  const [proposed, setProposed] = useState<Record<string, NewEntity>>({});
  const [nextBusy, setNextBusy] = useState(false);
  const [combatAiBusy, setCombatAiBusy] = useState(false);
  // Режим показа игрокам — прячет секции, помеченные «только мастер».
  const [playerView, setPlayerView] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    api.getDocument(documentId).then((d) => {
      setDoc(d);
    }).catch(() => showToast("Не удалось загрузить сессию"));
  }, [documentId, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    api.getCampaign(campaignId).then((c) => setCampaignName(c.name)).catch(() => {});
    api.listCampaignDocuments(campaignId).then(setDocs).catch(() => {});
  }, [campaignId]);

  // Единый писатель полей: мерджит с актуальным doc.fields и сохраняет целиком.
  const patchFields = useCallback(async (partial: Record<string, unknown>): Promise<boolean> => {
    const base = docRef.current;
    if (!base || !documentId) return false;
    try {
      const u = await api.updateDocument(documentId, { fields: { ...base.fields, ...partial } });
      setDoc(u);
      docRef.current = u;
      return true;
    } catch {
      showToast("Не удалось сохранить");
      return false;
    }
  }, [documentId, showToast]);

  // Игровой чат с ИИ-мастером: состояние здесь, чтобы лог-панель строилась из тех же сообщений.
  const chat = useGameChat(documentId!, (content) => {
    openMentionedDocs(content);
    parseAssistant(content).newDocs.forEach((nd) => showProposedDoc(nd));
  });

  // Текстовое представление лога событий — для промпта ИИ-мастера и сбора боя.
  const gameLogText = (msgs: GameMsg[]) =>
    msgs.filter((m) => m.meta?.log)
      .map((m) => `- ${m.meta!.log!.important ? "[важно] " : ""}${m.meta!.log!.title}`)
      .join("\n");

  // Системный промпт ИИ-мастера: план сессии + лог + правила формата ответа.
  function buildGameSystem(): string {
    const d = docRef.current;
    const logLines = gameLogText(chat.messages);
    return (
      `Ты — ИИ-мастер настольной ролевой игры, помогаешь живому мастеру вести сессию «${d?.title ?? ""}» кампании «${campaignName}». Всегда отвечай по-русски.\n\n` +
      `План сессии:\n${d ? pmText(d.contentJson).trim() || "(пусто)" : "(пусто)"}\n\n` +
      (logLines ? `Лог событий этой сессии:\n${logLines}\n\n` : "") +
      `Сообщения вида «Действие (Имя): …» — заявки персонажей игроков или NPC. На такую заявку отвечай СТРОГО в формате:\n` +
      `## Прочитай игрокам\n<живое описание происходящего для чтения игрокам вслух, 2–6 предложений>\n` +
      `## Скрытое для мастера\n<то, что игроки не видят: механика, сложности проверок, скрытые последствия, планы NPC; если скрывать нечего — пропусти секцию целиком>\n` +
      `В САМОМ КОНЦЕ такого ответа добавь служебный блок:\n` +
      "```log\n" +
      `{"title": "<краткий заголовок события, 3–7 слов>", "important": <true только для поворотных событий: смерть, крупная находка, раскрытие тайны, начало и исход боя; иначе false>}\n` +
      "```\n\n" +
      `Остальные сообщения — вопросы мастера тебе: отвечай обычным текстом, без секций и без log-блока.\n\n` +
      entityBlocksPrompt(docs.map((x) => ({ title: x.title, type: x.type })))
    );
  }

  // Переход из лога к сообщению в ленте чата.
  function jumpToMessage(messageId: string) {
    const el = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("msg-flash");
    setTimeout(() => el.classList.remove("msg-flash"), 1600);
  }

  const sections = useMemo(() => (doc ? splitSections(doc.contentJson) : []), [doc]);
  const sectionVis: Record<string, string> = (doc?.fields?.sectionVisibility as Record<string, string>) ?? {};
  const isGmOnly = (heading: string | null) => !!heading && sectionVis[heading] === "gm";
  function toggleSectionVis(heading: string) {
    const next = { ...sectionVis };
    if (next[heading] === "gm") delete next[heading]; else next[heading] = "gm";
    void patchFields({ sectionVisibility: next });
  }
  const prepared = useMemo(
    () => prepareMentions(docs.filter((d) => d.id !== documentId).map((d) => ({ title: d.title, type: d.type, href: d.id }))),
    [docs, documentId],
  );

  // Делаем упоминания в тексте сессии кликабельными (по всем видимым секциям).
  useEffect(() => {
    if (contentRef.current) linkifyMentions(contentRef.current, prepared);
  }, [sections, prepared, playerView, sectionVis]);

  function openDoc(id: string) {
    if (!id) return;
    setTab("docs");
    setView((v) => {
      if (v.idx >= 0 && v.stack[v.idx] === id) return v;
      const stack = v.stack.slice(0, v.idx + 1);
      stack.push(id);
      return { stack, idx: stack.length - 1 };
    });
  }

  // Открывает в просмотрщике документы кампании, упомянутые в реплике чата с ИИ-мастером.
  function openMentionedDocs(text: string) {
    for (const span of matchMentions(text, prepared)) {
      if (span.href) openDoc(span.href);
    }
  }

  // Применяет предложенный ассистентом текст к самому документу сессии и обновляет левую панель.
  // Отмечаем блок применённым в fields — чтобы карточка не «оживала» после перезахода.
  function applyToSession(text: string) {
    if (!doc || !documentId) return;
    const prevFields = docRef.current?.fields ?? {};
    const prev = (prevFields.appliedDocBlocks as string[] | undefined) ?? [];
    const key = blockKey(text);
    const appliedDocBlocks = prev.includes(key) ? prev : [...prev, key];
    api.updateDocument(documentId, { contentJson: markdownToDoc(text), fields: { ...prevFields, appliedDocBlocks } })
      .then((updated) => { setDoc(updated); showToast("Документ обновлён"); })
      .catch(() => showToast("Не удалось обновить документ"));
  }

  // Показывает превью предлагаемой к созданию сущности (реального документа ещё нет).
  function showProposedDoc(entity: NewEntity) {
    const id = `proposed:${entity.title}`;
    setProposed((p) => ({ ...p, [id]: entity }));
    openDoc(id);
  }

  // Собрать участников боя из чата ИИ-мастера + текста сессии через ИИ.
  async function aiFillCombat() {
    if (!doc || !documentId || combatAiBusy) return;
    setCombatAiBusy(true);
    try {
      const conv = await api.getDocumentConversation(documentId).catch(() => []);
      const chat2 = conv.map((m) => `${m.role === "user" ? "Мастер" : "ИИ"}: ${m.content}`).join("\n");
      let out = "";
      await streamComplete(
        {
          system:
            "Ты — ассистент мастера НРИ. Определи участников БОЯ (враги и союзники, вступающие в схватку) из контекста ниже. " +
            "Верни ТОЛЬКО JSON {\"combatants\":[{\"name\":\"Имя\",\"init\":0,\"hp\":10}]}. init и hp можешь оценить по описанию (иначе 0 и 10). " +
            "Только тех, кто реально дерётся; если участников нет — {\"combatants\":[]}.",
          messages: [{ role: "user", content: `Текст сессии:\n${pmText(doc.contentJson).trim()}\n\nЛог за столом:\n${gameLogText(chat.messages) || "(пусто)"}\n\nЧат с ИИ-мастером:\n${chat2 || "(пусто)"}` }],
          campaignId,
        },
        (c) => { out += c; },
      );
      const found = parseCombatants(out);
      if (!found.length) { showToast("ИИ не нашёл участников боя"); return; }
      const cur = (docRef.current?.fields?.combat as CombatState) ?? { round: 1, turn: 0, combatants: [] };
      const existing = new Set(cur.combatants.map((c) => c.name.toLowerCase()));
      const added = found
        .filter((f) => !existing.has(f.name.toLowerCase()))
        .map((f) => ({ id: crypto.randomUUID(), name: f.name, init: f.init, hp: f.hp, maxHp: f.hp, conditions: "" }));
      const combatants = [...cur.combatants, ...added].sort((a, b) => b.init - a.init);
      await patchFields({ combat: { ...cur, combatants } });
      showToast(added.length ? `Добавлено участников: ${added.length}` : "Все участники уже в списке");
    } catch {
      showToast("Не удалось собрать участников боя");
    } finally {
      setCombatAiBusy(false);
    }
  }

  // Пины — часто нужные под рукой документы этой сессии (хранятся в fields.pins).
  const pins: string[] = Array.isArray(doc?.fields?.pins) ? (doc!.fields!.pins as string[]) : [];
  const pinnedDocs = pins.map((id) => docs.find((d) => d.id === id)).filter((d): d is Document => !!d);
  function togglePin(id: string) {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    void patchFields({ pins: next });
  }

  const viewerId = view.idx >= 0 ? view.stack[view.idx] : null;
  const viewerDoc = (viewerId && docs.find((d) => d.id === viewerId)) || null;
  const viewerProposed = viewerId && !viewerDoc ? proposed[viewerId] ?? null : null;

  function exit() {
    navigate(`/campaigns/${campaignId}`, { replace: true });
  }

  // Завершить сессию: ИИ подводит итоги и создаёт следующую сессию с готовым пересказом.
  async function endAndCreateNext() {
    if (!documentId || nextBusy) return;
    setNextBusy(true);
    showToast("Подводим итоги сессии и готовим следующую — это может занять до минуты…");
    try {
      const next = await api.nextSession(documentId);
      showToast(`Создана «${next.title}» — итоги и пересказ готовы`);
      navigate(`/campaigns/${campaignId}/documents/${next.id}`, { replace: true });
    } catch {
      showToast("Не удалось создать следующую сессию");
      setNextBusy(false);
    }
  }

  // Акторы для чипов в игровом чате.
  const pcs = docs
    .filter((d) => d.type === "pc" && d.status !== "retired" && d.status !== "deceased")
    .map((d) => ({ id: d.id, title: d.title }));
  const npcs = docs.filter((d) => d.type === "npc").map((d) => ({ id: d.id, title: d.title }));

  if (!doc) return <div className="play-mode"><p className="muted" style={{ padding: 24 }}>…</p></div>;

  return (
    <div className="play-mode">
      <header className="play-head">
        <div className="play-head-title">
          <strong>{doc.title}</strong>
          <span className="play-head-campaign">{campaignName}</span>
        </div>
        <div className="play-head-right">
          <span className="play-badge">● PLAY MODE</span>
          <button type="button" className={`btn-ghost play-playerview${playerView ? " active" : ""}`} onClick={() => setPlayerView((v) => !v)} title="Показ игрокам: скрыть секции «только мастер»">
            {playerView ? <Eye size={15} /> : <EyeOff size={15} />} {playerView ? "Показ игрокам" : "Всё видно"}
          </button>
          <button type="button" className="btn-ghost play-next" onClick={endAndCreateNext} disabled={nextBusy} title="Завершить сессию: ИИ подведёт итоги и создаст следующую">
            {nextBusy ? "Создаём…" : <>Следующая сессия <ArrowRight size={15} /></>}
          </button>
          <button type="button" className="btn-ghost play-exit" onClick={exit}><X size={16} /> Выйти</button>
        </div>
      </header>

      <div className="play-body">
        <div className="play-center">
          <GameChat
            docId={documentId!}
            chat={chat}
            pcs={pcs}
            npcs={npcs}
            documents={docs.map((d) => ({ title: d.title, type: d.type }))}
            buildSystem={buildGameSystem}
            playerView={playerView}
            currentText={pmText(doc.contentJson).trim()}
            appliedBlocks={(doc.fields?.appliedDocBlocks as string[] | undefined) ?? []}
            docUpdatedAt={(doc.fields?.contentUpdatedAt as string | undefined) ?? doc.updatedAt}
            onApply={applyToSession}
            onCreateEntity={() => showToast("Создавайте сущности вне режима игры")}
            onEditEntity={() => showToast("Изменяйте документы вне режима игры")}
          />
        </div>

        <aside className="play-side">
          {!playerView && (
            <GameLogPanel messages={chat.messages} onJump={jumpToMessage} onToggleImportant={(id) => void chat.toggleImportant(id)} />
          )}

          <div className="play-panel">
            <div className="play-tabs2">
              <button type="button" className={tab === "scenario" ? "active" : ""} onClick={() => setTab("scenario")}>Сценарий</button>
              <button type="button" className={tab === "docs" ? "active" : ""} onClick={() => setTab("docs")}>Документы</button>
              <button type="button" className={tab === "combat" ? "active" : ""} onClick={() => setTab("combat")}>Бой</button>
            </div>
            {/* Все вкладки смонтированы всегда — переключение прячет, а не размонтирует. */}
            <div
              className="play-content play-scenario"
              style={{ display: tab === "scenario" ? undefined : "none" }}
              ref={contentRef}
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest("a.play-link") as HTMLElement | null;
                if (!a?.dataset.docId) return;
                e.preventDefault();
                // Одноимённые документы: повторный клик открывает следующий по кругу.
                const ids = a.dataset.docIds ? a.dataset.docIds.split(",") : [];
                if (ids.length > 1) openDoc(ids[(ids.indexOf(view.stack[view.idx]) + 1) % ids.length]);
                else openDoc(a.dataset.docId);
              }}
            >
              {sections.length === 0 ? (
                <p className="muted">Сессия пуста — заполните её на странице документа.</p>
              ) : (
                sections.map((sec, i) => {
                  const gm = isGmOnly(sec.heading);
                  if (playerView && gm) return null;
                  return (
                    <div key={i} className={`play-section${gm ? " gm" : ""}`}>
                      {sec.heading && (
                        <div className="play-section-bar">
                          <button type="button" className="play-eye" onClick={() => toggleSectionVis(sec.heading!)} title={gm ? "Виден игрокам (снять пометку)" : "Пометить «только мастер»"}>
                            {gm ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          {gm && <span className="play-section-lock">только мастер</span>}
                        </div>
                      )}
                      <div className="md" dangerouslySetInnerHTML={{ __html: contentToHtml(sec.doc) }} />
                    </div>
                  );
                })
              )}
            </div>

            <div className="play-viewer" style={{ display: tab === "docs" ? undefined : "none" }}>
              <div className="play-viewer-nav">
                <button type="button" title="Назад" aria-label="Назад" disabled={view.idx <= 0} onClick={() => setView((v) => ({ ...v, idx: v.idx - 1 }))}><ArrowLeft size={15} /></button>
                <button type="button" title="Вперёд" aria-label="Вперёд" disabled={view.idx >= view.stack.length - 1} onClick={() => setView((v) => ({ ...v, idx: v.idx + 1 }))}><ArrowRight size={15} /></button>
                {viewerDoc && <span className="play-viewer-title">{viewerDoc.title}</span>}
                {viewerProposed && <span className="play-viewer-title">{viewerProposed.title} <span className="play-proposed-tag">предлагается создать</span></span>}
                {viewerDoc && (
                  <button
                    type="button"
                    className={`play-pin-btn${pins.includes(viewerDoc.id) ? " active" : ""}`}
                    onClick={() => togglePin(viewerDoc.id)}
                    title={pins.includes(viewerDoc.id) ? "Открепить" : "Закрепить под рукой"}
                    aria-label={pins.includes(viewerDoc.id) ? "Открепить" : "Закрепить"}
                  >
                    <Pin size={14} strokeWidth={1.9} />
                  </button>
                )}
              </div>
              {pinnedDocs.length > 0 && (
                <div className="play-pins">
                  {pinnedDocs.map((d) => (
                    <span key={d.id} className={`play-pin${viewerId === d.id ? " active" : ""}`}>
                      <button type="button" className="play-pin-open" onClick={() => openDoc(d.id)} title={d.title}>
                        <TypeBadge type={d.type} size={14} /> <span>{d.title}</span>
                      </button>
                      <button type="button" className="play-pin-x" onClick={() => togglePin(d.id)} aria-label="Открепить">×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="play-viewer-body">
                {viewerDoc ? (
                  <div className="md" dangerouslySetInnerHTML={{ __html: contentToHtml(viewerDoc.contentJson) }} />
                ) : viewerProposed ? (
                  <div className="play-proposed">
                    <div className="play-proposed-head"><TypeTag type={viewerProposed.type} /></div>
                    {viewerProposed.text ? <Markdown>{viewerProposed.text}</Markdown> : <p className="muted">Описание появится после создания.</p>}
                  </div>
                ) : (
                  <p className="muted play-viewer-empty">Кликните по ссылке в сессии, чтобы открыть документ здесь.</p>
                )}
              </div>
            </div>

            <div className="play-combat-wrap" style={{ display: tab === "combat" ? undefined : "none" }}>
              <CombatTracker
                combat={(doc.fields?.combat as CombatState) ?? null}
                onChange={(c) => void patchFields({ combat: c })}
                candidates={docs.filter((d) => d.type === "pc" || d.type === "npc").map((d) => ({ id: d.id, title: d.title, type: d.type }))}
                onAiFill={aiFillCombat}
                aiBusy={combatAiBusy}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
