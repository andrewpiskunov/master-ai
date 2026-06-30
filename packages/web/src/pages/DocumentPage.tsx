import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getDocumentType, statusLabel, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocumentEditor, textToHtml, type DocumentEditorHandle } from "../editor/DocumentEditor.js";
import { useGoBack } from "../useGoBack.js";
import { useToast } from "../ui/toast.js";
import { Select } from "../ui/Select.js";
import { Modal } from "../ui/Modal.js";
import { LinksPanel } from "./LinksPanel.js";
import { DocumentAssistant, type NewEntity } from "./DocumentAssistant.js";
import { ChangeTypeMenu, TypeBadge, typeColor, useCampaign } from "./campaign/shared.js";

// Собирает JSON-документ ProseMirror из текста с разметкой — тем же путём
// (textToHtml → generateJSON), что и редактор, чтобы заголовки/списки отрисовались.
function textToDoc(text: string): unknown {
  return generateJSON(textToHtml(text) || "<p></p>", [StarterKit]);
}

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
  const { campaignId, documentId } = useParams<{ campaignId: string; documentId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack(`/campaigns/${campaignId ?? ""}`);
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
  const [deleting, setDeleting] = useState(false);
  const editorRef = useRef<DocumentEditorHandle>(null);

  useEffect(() => {
    if (!documentId) return;
    // Прячем редактор на время загрузки: TipTap инициализирует контент только
    // при монтировании, поэтому редактор должен монтироваться уже с новым документом.
    setDoc(null);
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

  // Создаёт новую сущность по предложению ИИ и связывает её с текущим документом.
  async function createEntity(entity: NewEntity) {
    if (!doc) return;
    const type = getDocumentType(entity.type) ? entity.type : "note";
    try {
      const created = await api.createDocument({
        campaignId: doc.campaignId,
        type,
        title: entity.title,
        contentJson: textToDoc(entity.text),
      });
      await api.createLink({ campaignId: doc.campaignId, fromDocId: doc.id, toDocId: created.id, kind: "упоминает" }).catch(() => {});
      campaignCtx?.reload();
      showToast(`Создано: «${created.title}»`);
      navigate(`/campaigns/${doc.campaignId}/documents/${created.id}`);
    } catch {
      showToast("Не удалось создать сущность");
    }
  }

  // Меняет тип документа (как «Change type» в Arks); статус сервер сбросит при несовместимости.
  async function changeType(type: string) {
    if (!documentId) return;
    try {
      const updated = await api.updateDocument(documentId, { type });
      setDoc(updated);
      setStatus(updated.status ?? "");
      campaignCtx?.reload();
      showToast("Тип изменён");
    } catch {
      showToast("Не удалось изменить тип");
    }
  }

  // Удаляет документ и возвращает на предыдущую страницу.
  async function remove() {
    if (!documentId) return;
    try {
      await api.deleteDocument(documentId);
      campaignCtx?.reload();
      showToast("Документ удалён");
      goBack();
    } catch {
      showToast("Не удалось удалить документ");
    }
  }

  if (!doc) return <div className="view"><p className="muted">…</p></div>;

  const t = getDocumentType(doc.type);
  const statuses = t?.statuses ?? [];

  return (
    <div className="view doc-view" style={{ "--doc-accent": typeColor(doc.type) } as CSSProperties}>
      <div className="doc-grid">
        <div className="doc-main">
          <header className="view-head doc-head">
            <TypeBadge type={doc.type} size={40} />
            <div className="doc-head-main">
              <button type="button" className="doc-back" onClick={goBack}>
                <ArrowLeft size={15} /> Назад
              </button>
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
            <ChangeTypeMenu current={doc.type} onChange={changeType} />
            <button type="button" className="btn-ghost doc-delete" onClick={() => setDeleting(true)} title="Удалить документ">
              <Trash2 size={16} strokeWidth={1.8} />
            </button>
          </header>

          <DocumentEditor
            ref={editorRef}
            key={documentId}
            content={contentJson}
            onChange={setContentJson}
            mentions={mentions}
          />
          <LinksPanel campaignId={doc.campaignId} documentId={doc.id} />
        </div>

        <aside className="doc-side">
          <DocumentAssistant
            docId={doc.id}
            title={title}
            typeLabel={t?.label ?? doc.type}
            getText={() => pmText(contentJson).trim()}
            onApply={(text) => editorRef.current?.applyText(text)}
            onCreateEntity={createEntity}
          />
        </aside>
      </div>

      {deleting && (
        <Modal title="Удалить документ" onClose={() => setDeleting(false)}>
          <p className="muted">
            Документ «{title || doc.title}» ({t?.label ?? doc.type}) и его связи будут удалены безвозвратно.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn-danger" onClick={remove}>Удалить навсегда</button>
            <button type="button" className="btn-ghost" onClick={() => setDeleting(false)}>Отмена</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
