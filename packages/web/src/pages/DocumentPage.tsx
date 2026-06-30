import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, Bookmark as BookmarkIcon, Printer, EyeOff } from "lucide-react";
import { getDocumentType, getTemplate, statusLabel, DISPOSITIONS, getDisposition, hasDisposition, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { DocumentEditor, markdownToDoc, type DocumentEditorHandle } from "../editor/DocumentEditor.js";
import { useGoBack } from "../useGoBack.js";
import { useToast } from "../ui/toast.js";
import { Select } from "../ui/Select.js";
import { Modal } from "../ui/Modal.js";
import { LinksPanel } from "./LinksPanel.js";
import { DocumentAssistant, type NewEntity } from "./DocumentAssistant.js";
import { PlayPanel } from "./PlayPanel.js";
import { ChangeTypeMenu, TypeBadge, typeColor, useCampaign } from "./campaign/shared.js";
import { isBookmarked, toggleBookmark } from "../bookmarks.js";

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
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [deleting, setDeleting] = useState(false);
  const [panel, setPanel] = useState<"assistant" | "play">("assistant");
  const [marked, setMarked] = useState(false);
  const editorRef = useRef<DocumentEditorHandle>(null);

  useEffect(() => { if (documentId) setMarked(isBookmarked(documentId)); }, [documentId]);

  function toggleMark() {
    if (!doc) return;
    setMarked(toggleBookmark({ id: doc.id, campaignId: doc.campaignId, title: doc.title, type: doc.type }));
  }

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
      setFields(d.fields ?? {});
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

  // Мгновенно сохраняет «тег» (статус, отношение, пометку) — как в Arks, без кнопки «Сохранить».
  async function patchDoc(p: { status?: string | null; fields?: Record<string, unknown> }) {
    if (!documentId) return;
    try {
      const updated = await api.updateDocument(documentId, p);
      setDoc(updated);
      setStatus(updated.status ?? "");
      setFields(updated.fields ?? {});
      campaignCtx?.reload();
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
        contentJson: markdownToDoc(entity.text),
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

  // Вставляет ссылку на игровой материал в документ и связывает их.
  async function insertReference(target: Document) {
    if (!doc) return;
    editorRef.current?.insertReference(target.title);
    await api.createLink({ campaignId: doc.campaignId, fromDocId: doc.id, toDocId: target.id, kind: "связан" }).catch(() => {});
    showToast(`Вставлено: «${target.title}»`);
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
  const disposition = typeof fields.disposition === "string" ? fields.disposition : "";
  const dispDef = getDisposition(disposition);
  const gmOnly = fields.gmOnly === true;

  return (
    <div className="view doc-view" style={{ "--doc-accent": typeColor(doc.type) } as CSSProperties}>
      <div className="doc-grid">
        <div className="doc-main">
          <header className="view-head doc-head">
            <div className="doc-head-top">
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
            </div>
            {hasDisposition(doc.type) && (
              <Select
                ariaLabel="Отношение к партии"
                value={disposition}
                onChange={(v) => patchDoc({ fields: { ...fields, disposition: v } })}
                placeholder="Отношение"
                tag
                dotColor={dispDef?.color}
                options={[{ value: "", label: "Без отношения" }, ...DISPOSITIONS.map((d) => ({ value: d.key, label: d.label }))]}
              />
            )}
            {statuses.length > 0 && (
              <Select
                ariaLabel="Статус"
                value={status}
                onChange={(v) => patchDoc({ status: v === "" ? null : v })}
                placeholder="Статус"
                tag
                options={[{ value: "", label: "Без статуса" }, ...statuses.map((s) => ({ value: s, label: statusLabel(s) }))]}
              />
            )}
            {hasDisposition(doc.type) && (
              <button
                type="button"
                className={`tag-toggle${gmOnly ? " active" : ""}`}
                onClick={() => patchDoc({ fields: { ...fields, gmOnly: !gmOnly } })}
                title="Скрыто от игроков — пометка для мастера"
                aria-pressed={gmOnly}
              >
                <EyeOff size={13} strokeWidth={1.8} /> Только мастер
              </button>
            )}
            <button type="button" onClick={save}>Сохранить</button>
            <button type="button" className={`btn-ghost icon-btn doc-bookmark${marked ? " active" : ""}`} onClick={toggleMark} title={marked ? "Убрать из закладок" : "В закладки"} aria-pressed={marked}>
              <BookmarkIcon size={16} strokeWidth={1.8} fill={marked ? "currentColor" : "none"} />
            </button>
            <button type="button" className="btn-ghost icon-btn" onClick={() => navigate(`/campaigns/${doc.campaignId}/documents/${doc.id}/print`)} title="Печать">
              <Printer size={16} strokeWidth={1.8} />
            </button>
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
          <div className="panel-tabs">
            <button type="button" className={panel === "assistant" ? "active" : ""} onClick={() => setPanel("assistant")}>Помощник</button>
            <button type="button" className={panel === "play" ? "active" : ""} onClick={() => setPanel("play")}>Играть</button>
          </div>
          {panel === "assistant" ? (
            <DocumentAssistant
              docId={doc.id}
              title={title}
              typeLabel={t?.label ?? doc.type}
              template={getTemplate(doc.type)}
              getText={() => pmText(contentJson).trim()}
              onApply={(text) => editorRef.current?.applyText(text)}
              onCreateEntity={createEntity}
            />
          ) : (
            <PlayPanel documents={allDocuments} currentId={doc.id} onInsert={insertReference} />
          )}
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
