import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X, ArrowLeft, ArrowRight, Pin, Eye, EyeOff, Sparkles } from "lucide-react";
import { getDocumentType, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { streamComplete } from "../api/stream.js";
import { useToast } from "../ui/toast.js";
import { Markdown } from "../ui/Markdown.js";
import { contentToHtml } from "../editor/contentToHtml.js";
import { pmText } from "../prosemirror-text.js";
import { markdownToDoc } from "../editor/DocumentEditor.js";
import { DocumentAssistant } from "./DocumentAssistant.js";
import { blockKey, type NewEntity } from "./assistant-blocks.js";
import { CombatTracker, type CombatState } from "./CombatTracker.js";
import { TypeTag, TypeBadge } from "./campaign/shared.js";
import { prepareMentions, matchMentions, type MentionItem } from "../mentions.js";

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

// Режим прогона сессии за столом: текст сессии, просмотрщик связанных документов, лог и ассистент.
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
  const [tab, setTab] = useState<"log" | "assistant" | "combat">("log");
  const [log, setLog] = useState("");
  const [logSaved, setLogSaved] = useState(true);
  const logRef = useRef<string>("");
  const contentRef = useRef<HTMLDivElement>(null);
  // История просмотрщика связанных документов.
  const [view, setView] = useState<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  // Предлагаемые ассистентом к созданию сущности (документа ещё нет в базе) — по синтетическому id.
  const [proposed, setProposed] = useState<Record<string, NewEntity>>({});
  const [nextBusy, setNextBusy] = useState(false);
  const [combatAiBusy, setCombatAiBusy] = useState(false);
  const [logAiBusy, setLogAiBusy] = useState(false);
  // Режим показа игрокам — прячет секции, помеченные «только мастер».
  const [playerView, setPlayerView] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    api.getDocument(documentId).then((d) => {
      setDoc(d);
      const saved = typeof d.fields?.sessionLog === "string" ? d.fields.sessionLog : "";
      setLog(saved);
      logRef.current = saved;
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

  // Автосохранение лога сессии (через единый писатель полей).
  useEffect(() => {
    if (!doc || log === logRef.current) return;
    setLogSaved(false);
    const timer = setTimeout(async () => {
      if (await patchFields({ sessionLog: log })) { logRef.current = log; setLogSaved(true); }
    }, 700);
    return () => clearTimeout(timer);
  }, [log, doc, patchFields]);

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
    setView((v) => {
      if (v.idx >= 0 && v.stack[v.idx] === id) return v; // уже открыт — не дублируем
      const stack = v.stack.slice(0, v.idx + 1);
      stack.push(id);
      return { stack, idx: stack.length - 1 };
    });
  }

  // Открывает в просмотрщике документы кампании, упомянутые в реплике чата с ассистентом.
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

  // ИИ дописывает в лог важные события из чата и текста сессии (не перезаписывая).
  async function aiAppendLog() {
    if (!doc || !documentId || logAiBusy) return;
    setLogAiBusy(true);
    try {
      const conv = await api.getDocumentConversation(documentId).catch(() => []);
      const chat = conv.map((m) => `${m.role === "user" ? "Мастер" : "ИИ"}: ${m.content}`).join("\n");
      let out = "";
      await streamComplete(
        {
          system:
            "Ты — ассистент мастера НРИ, ведёшь лог игровой сессии. По тексту сессии, чату с ассистентом и текущему логу " +
            "выпиши КРАТКИЕ строки о важных событиях, которых ЕЩЁ НЕТ в логе: решения игроков, бой и его исход, находки/добыча, " +
            "изменения статусов NPC, новые зацепки. Каждое событие — с новой строки, начиная с «- ». По-русски, лаконично. " +
            "Если ничего нового нет — верни пустую строку.",
          messages: [{ role: "user", content: `Текст сессии:\n${pmText(doc.contentJson).trim() || "(пусто)"}\n\nЧат с ассистентом:\n${chat || "(пусто)"}\n\nТекущий лог:\n${log || "(пусто)"}` }],
          campaignId,
        },
        (c) => { out += c; },
      );
      // Берём только строки-события (маркер списка), отсекая пояснения ИИ вроде «Ничего нового…».
      const lines = out.split("\n").map((l) => l.trim()).filter((l) => /^[-•*]\s+/.test(l));
      if (!lines.length) { showToast("ИИ не нашёл новых событий для лога"); return; }
      const add = lines.join("\n");
      setLog((prev) => (prev.trim() ? `${prev.trimEnd()}\n${add}` : add));
      showToast("Лог дополнен ИИ");
    } catch {
      showToast("Не удалось дополнить лог");
    } finally {
      setLogAiBusy(false);
    }
  }

  // Собрать участников боя из чата ассистента + текста и лога сессии через ИИ.
  async function aiFillCombat() {
    if (!doc || !documentId || combatAiBusy) return;
    setCombatAiBusy(true);
    try {
      const conv = await api.getDocumentConversation(documentId).catch(() => []);
      const chat = conv.map((m) => `${m.role === "user" ? "Мастер" : "ИИ"}: ${m.content}`).join("\n");
      let out = "";
      await streamComplete(
        {
          system:
            "Ты — ассистент мастера НРИ. Определи участников БОЯ (враги и союзники, вступающие в схватку) из контекста ниже. " +
            "Верни ТОЛЬКО JSON {\"combatants\":[{\"name\":\"Имя\",\"init\":0,\"hp\":10}]}. init и hp можешь оценить по описанию (иначе 0 и 10). " +
            "Только тех, кто реально дерётся; если участников нет — {\"combatants\":[]}.",
          messages: [{ role: "user", content: `Текст сессии:\n${pmText(doc.contentJson).trim()}\n\nЛог за столом:\n${log || "(пусто)"}\n\nЧат с ассистентом:\n${chat || "(пусто)"}` }],
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
        <div
          className="play-content"
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

        <aside className="play-side">
          <div className="play-viewer">
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

          <div className="play-panel">
            <div className="play-tabs2">
              <button type="button" className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>Лог сессии</button>
              <button type="button" className={tab === "assistant" ? "active" : ""} onClick={() => setTab("assistant")}>Ассистент</button>
              <button type="button" className={tab === "combat" ? "active" : ""} onClick={() => setTab("combat")}>Бой</button>
              {tab === "log" && <span className={`play-draft${logSaved ? " saved" : ""}`}>{logSaved ? "Сохранено" : "Черновик"}</span>}
            </div>
            {/* Обе панели смонтированы всегда — переключение прячет, а не размонтирует,
                чтобы не терялись состояние ассистента (например, «применено») и черновик. */}
            <div className="play-log-wrap" style={{ display: tab === "log" ? undefined : "none" }}>
              <textarea
                className="play-log"
                placeholder="Записывайте, что происходит — имена, решения, добыча. Введите «@», чтобы сослаться на что угодно в кампании."
                value={log}
                onChange={(e) => setLog(e.target.value)}
              />
              <div className="play-log-bar">
                <button type="button" className="play-log-ai" onClick={aiAppendLog} disabled={logAiBusy} title="ИИ выпишет важные события из чата и текста сессии и допишет их в лог">
                  <Sparkles size={13} /> {logAiBusy ? "Дописываю…" : "Дописать в лог с ИИ"}
                </button>
              </div>
            </div>
            <div className="play-assistant" style={{ display: tab === "assistant" ? undefined : "none" }}>
              <DocumentAssistant
                docId={doc.id}
                title={doc.title}
                typeLabel={getDocumentType(doc.type)?.label ?? doc.type}
                documents={docs.map((d) => ({ title: d.title, type: d.type }))}
                campaignBrief={`Идёт игровая сессия «${doc.title}». Текст сессии:\n${pmText(doc.contentJson).trim()}\n\nЛог за столом:\n${log || "(пока пусто)"}`}
                getText={() => pmText(doc.contentJson).trim()}
                appliedBlocks={(doc.fields?.appliedDocBlocks as string[] | undefined) ?? []}
                docUpdatedAt={(doc.fields?.contentUpdatedAt as string | undefined) ?? doc.updatedAt}
                onApply={applyToSession}
                onCreateEntity={() => showToast("Создавайте сущности вне режима игры")}
                onEditEntity={() => showToast("Изменяйте документы вне режима игры")}
                onMessage={openMentionedDocs}
                onProposeDoc={showProposedDoc}
              />
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
