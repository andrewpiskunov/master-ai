import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { generateHTML } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { getDocumentType, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { useToast } from "../ui/toast.js";
import { SuggestionMark } from "../editor/SuggestionMark.js";
import { DocumentAssistant } from "./DocumentAssistant.js";

function contentToHtml(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  try {
    return generateHTML(content as Record<string, unknown>, [StarterKit, SuggestionMark]);
  } catch {
    return "";
  }
}

// Извлекает плоский текст из JSON-документа ProseMirror.
function pmText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[]; type?: string };
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(pmText).join("") : "";
  return n.type && n.type !== "text" ? inner + "\n" : inner;
}

// Режим прогона сессии за столом: слева — текст сессии, справа — лог и ассистент.
export function PlaySession() {
  const { campaignId, documentId } = useParams<{ campaignId: string; documentId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [doc, setDoc] = useState<Document | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [tab, setTab] = useState<"log" | "assistant">("log");
  const [log, setLog] = useState("");
  const [logSaved, setLogSaved] = useState(true);
  const logRef = useRef<string>("");

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
    if (campaignId) api.getCampaign(campaignId).then((c) => setCampaignName(c.name)).catch(() => {});
  }, [campaignId]);

  // Автосохранение лога сессии в fields.sessionLog.
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

  function exit() {
    navigate(`/campaigns/${campaignId}`, { replace: true });
  }

  if (!doc) return <div className="play-mode"><p className="muted" style={{ padding: 24 }}>…</p></div>;
  const html = contentToHtml(doc.contentJson);

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
        <div className="play-content">
          {html ? <div className="md" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="muted">Сессия пуста — заполните её на странице документа.</p>}
        </div>

        <aside className="play-side">
          <div className="play-tabs2">
            <button type="button" className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>Лог сессии</button>
            <button type="button" className={tab === "assistant" ? "active" : ""} onClick={() => setTab("assistant")}>Ассистент</button>
            {tab === "log" && <span className={`play-draft${logSaved ? " saved" : ""}`}>{logSaved ? "Сохранено" : "Черновик"}</span>}
          </div>
          {tab === "log" ? (
            <textarea
              className="play-log"
              placeholder="Записывайте, что происходит — имена, решения, добыча. Введите «@», чтобы сослаться на что угодно в кампании."
              value={log}
              onChange={(e) => setLog(e.target.value)}
            />
          ) : (
            <div className="play-assistant">
              <DocumentAssistant
                docId={doc.id}
                title={doc.title}
                typeLabel={getDocumentType(doc.type)?.label ?? doc.type}
                documents={[]}
                campaignBrief={`Идёт игровая сессия «${doc.title}». Текст сессии:\n${pmText(doc.contentJson).trim()}\n\nЛог за столом:\n${log || "(пока пусто)"}`}
                getText={() => pmText(doc.contentJson).trim()}
                onApply={() => showToast("В режиме игры правка документа недоступна")}
                onCreateEntity={() => showToast("Создавайте сущности вне режима игры")}
                onEditEntity={() => showToast("Изменяйте документы вне режима игры")}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
