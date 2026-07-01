import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X, ArrowLeft, ArrowRight } from "lucide-react";
import { getDocumentType, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";
import { Markdown } from "../ui/Markdown.js";
import { contentToHtml } from "../editor/contentToHtml.js";
import { pmText } from "../prosemirror-text.js";
import { markdownToDoc } from "../editor/DocumentEditor.js";
import { DocumentAssistant, type NewEntity } from "./DocumentAssistant.js";
import { TypeTag } from "./campaign/shared.js";
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
      a.textContent = text.slice(s.start, s.end);
      frag.appendChild(a);
      last = s.end;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
}

// Режим прогона сессии за столом: текст сессии, просмотрщик связанных документов, лог и ассистент.
export function PlaySession() {
  const { campaignId, documentId } = useParams<{ campaignId: string; documentId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [doc, setDoc] = useState<Document | null>(null);
  const [docs, setDocs] = useState<Document[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [tab, setTab] = useState<"log" | "assistant">("log");
  const [log, setLog] = useState("");
  const [logSaved, setLogSaved] = useState(true);
  const logRef = useRef<string>("");
  const contentRef = useRef<HTMLDivElement>(null);
  // История просмотрщика связанных документов.
  const [view, setView] = useState<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  // Предлагаемые ассистентом к созданию сущности (документа ещё нет в базе) — по синтетическому id.
  const [proposed, setProposed] = useState<Record<string, NewEntity>>({});

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

  // Автосохранение лога сессии.
  useEffect(() => {
    if (!doc || !documentId || log === logRef.current) return;
    setLogSaved(false);
    const timer = setTimeout(() => {
      api.updateDocument(documentId, { fields: { ...doc.fields, sessionLog: log } })
        .then((u) => { logRef.current = log; setDoc(u); setLogSaved(true); })
        .catch(() => showToast("Не удалось сохранить лог"));
    }, 700);
    return () => clearTimeout(timer);
  }, [log, doc, documentId, showToast]);

  const sessionHtml = useMemo(() => (doc ? contentToHtml(doc.contentJson) : ""), [doc]);
  const prepared = useMemo(
    () => prepareMentions(docs.filter((d) => d.id !== documentId).map((d) => ({ title: d.title, type: d.type, href: d.id }))),
    [docs, documentId],
  );

  // Делаем упоминания в тексте сессии кликабельными.
  useEffect(() => {
    if (contentRef.current) linkifyMentions(contentRef.current, prepared);
  }, [sessionHtml, prepared]);

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
  function applyToSession(text: string) {
    if (!doc || !documentId) return;
    api.updateDocument(documentId, { contentJson: markdownToDoc(text) })
      .then((updated) => { setDoc(updated); showToast("Документ обновлён"); })
      .catch(() => showToast("Не удалось обновить документ"));
  }

  // Показывает превью предлагаемой к созданию сущности (реального документа ещё нет).
  function showProposedDoc(entity: NewEntity) {
    const id = `proposed:${entity.title}`;
    setProposed((p) => ({ ...p, [id]: entity }));
    openDoc(id);
  }

  const viewerId = view.idx >= 0 ? view.stack[view.idx] : null;
  const viewerDoc = (viewerId && docs.find((d) => d.id === viewerId)) || null;
  const viewerProposed = viewerId && !viewerDoc ? proposed[viewerId] ?? null : null;

  function exit() {
    navigate(`/campaigns/${campaignId}`, { replace: true });
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
          <button type="button" className="btn-ghost play-exit" onClick={exit}><X size={16} /> Выйти</button>
        </div>
      </header>

      <div className="play-body">
        <div
          className="play-content"
          ref={contentRef}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest("a.play-link") as HTMLElement | null;
            if (a?.dataset.docId) { e.preventDefault(); openDoc(a.dataset.docId); }
          }}
        >
          {sessionHtml ? <div className="md" dangerouslySetInnerHTML={{ __html: sessionHtml }} /> : <p className="muted">Сессия пуста — заполните её на странице документа.</p>}
        </div>

        <aside className="play-side">
          <div className="play-viewer">
            <div className="play-viewer-nav">
              <button type="button" title="Назад" aria-label="Назад" disabled={view.idx <= 0} onClick={() => setView((v) => ({ ...v, idx: v.idx - 1 }))}><ArrowLeft size={15} /></button>
              <button type="button" title="Вперёд" aria-label="Вперёд" disabled={view.idx >= view.stack.length - 1} onClick={() => setView((v) => ({ ...v, idx: v.idx + 1 }))}><ArrowRight size={15} /></button>
              {viewerDoc && <span className="play-viewer-title">{viewerDoc.title}</span>}
              {viewerProposed && <span className="play-viewer-title">{viewerProposed.title} <span className="play-proposed-tag">предлагается создать</span></span>}
            </div>
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
              {tab === "log" && <span className={`play-draft${logSaved ? " saved" : ""}`}>{logSaved ? "Сохранено" : "Черновик"}</span>}
            </div>
            {/* Обе панели смонтированы всегда — переключение прячет, а не размонтирует,
                чтобы не терялись состояние ассистента (например, «применено») и черновик. */}
            <textarea
              className="play-log"
              style={{ display: tab === "log" ? undefined : "none" }}
              placeholder="Записывайте, что происходит — имена, решения, добыча. Введите «@», чтобы сослаться на что угодно в кампании."
              value={log}
              onChange={(e) => setLog(e.target.value)}
            />
            <div className="play-assistant" style={{ display: tab === "assistant" ? undefined : "none" }}>
              <DocumentAssistant
                docId={doc.id}
                title={doc.title}
                typeLabel={getDocumentType(doc.type)?.label ?? doc.type}
                documents={docs.map((d) => ({ title: d.title, type: d.type }))}
                campaignBrief={`Идёт игровая сессия «${doc.title}». Текст сессии:\n${pmText(doc.contentJson).trim()}\n\nЛог за столом:\n${log || "(пока пусто)"}`}
                getText={() => pmText(doc.contentJson).trim()}
                onApply={applyToSession}
                onCreateEntity={() => showToast("Создавайте сущности вне режима игры")}
                onEditEntity={() => showToast("Изменяйте документы вне режима игры")}
                onMessage={openMentionedDocs}
                onProposeDoc={showProposedDoc}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
