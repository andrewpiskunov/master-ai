import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getDocumentType, statusLabel, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { DocumentEditor, type DocumentEditorHandle } from "../editor/DocumentEditor.js";
import { useToast } from "../ui/toast.js";
import { Select } from "../ui/Select.js";
import { LinksPanel } from "./LinksPanel.js";
import { DocumentAssistant } from "./DocumentAssistant.js";
import { TypeBadge, typeColor, useCampaign } from "./campaign/shared.js";

// Извлекает плоский текст из JSON-документа ProseMirror — для контекста ИИ-помощника.
function pmText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[]; type?: string };
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(pmText).join("") : "";
  // Блочные узлы разделяем переносом строки.
  return n.type && n.type !== "text" ? inner + "\n" : inner;
}

export function DocumentPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const { showToast } = useToast();
  const campaignCtx = useCampaign();
  const allDocuments = campaignCtx?.documents ?? [];
  const mentions = useMemo(
    () => allDocuments.filter((d) => d.id !== documentId).map((d) => ({ title: d.title, type: d.type })),
    [allDocuments, documentId],
  );
  const [doc, setDoc] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<string>("");
  const [contentJson, setContentJson] = useState<unknown>(null);
  const editorRef = useRef<DocumentEditorHandle>(null);

  useEffect(() => {
    if (!documentId) return;
    api.getDocument(documentId).then((d) => {
      setDoc(d);
      setTitle(d.title);
      setStatus(d.status ?? "");
      setContentJson(d.contentJson);
    }).catch(() => showToast("Не удалось загрузить документ"));
  }, [documentId, showToast]);

  async function save() {
    if (!documentId) return;
    try {
      const updated = await api.updateDocument(documentId, {
        title,
        status: status === "" ? null : status,
        contentJson,
      });
      setDoc(updated);
      showToast("Сохранено");
    } catch {
      showToast("Не удалось сохранить");
    }
  }

  if (!doc) return <div className="view"><p className="muted">…</p></div>;

  const t = getDocumentType(doc.type);
  const statuses = t?.statuses ?? [];

  return (
    <div className="view doc-view" style={{ "--doc-accent": typeColor(doc.type) } as CSSProperties}>
      <header className="view-head doc-head">
        <TypeBadge type={doc.type} size={40} />
        <div className="doc-head-main">
          <Link to={`/campaigns/${doc.campaignId}`} className="doc-back">
            <ArrowLeft size={15} /> {t?.label ?? doc.type}
          </Link>
          <input
            id="doc-title"
            aria-label="Заголовок"
            className="doc-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {statuses.length > 0 && (
          <Select
            ariaLabel="Статус"
            value={status}
            onChange={setStatus}
            placeholder="Статус"
            options={[{ value: "", label: "Без статуса" }, ...statuses.map((s) => ({ value: s, label: statusLabel(s) }))]}
          />
        )}
        <button type="button" onClick={save}>Сохранить</button>
      </header>

      <div className="doc-grid">
        <div className="doc-main">
          <DocumentEditor
            ref={editorRef}
            key={documentId}
            content={contentJson}
            onChange={setContentJson}
            mentions={mentions}
          />
        </div>
        <div className="ws-aside">
          <DocumentAssistant
            docId={doc.id}
            title={title}
            typeLabel={t?.label ?? doc.type}
            getText={() => pmText(contentJson).trim()}
            onApply={(text) => editorRef.current?.applyText(text)}
          />
          <LinksPanel campaignId={doc.campaignId} documentId={doc.id} />
        </div>
      </div>
    </div>
  );
}
