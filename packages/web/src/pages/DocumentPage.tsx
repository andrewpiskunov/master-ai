import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, Bookmark as BookmarkIcon, Printer, EyeOff, MessageCircle, Drama, Plus } from "lucide-react";
import { getDocumentType, getTemplate, statusLabel, DISPOSITIONS, getDisposition, hasDisposition, type Document } from "@master-ai/shared";
import { api } from "../api/client.js";
import { DocumentEditor, markdownToDoc, type DocumentEditorHandle } from "../editor/DocumentEditor.js";
import { useGoBack } from "../useGoBack.js";
import { useToast } from "../ui/toast.js";
import { Select } from "../ui/Select.js";
import { Modal } from "../ui/Modal.js";
import { DocumentAssistant, type NewEntity, type EditEntity } from "./DocumentAssistant.js";
import { PlayPanel } from "./PlayPanel.js";
import { ChangeTypeMenu, typeColor, typeColors, useCampaign } from "./campaign/shared.js";
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
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const editorRef = useRef<DocumentEditorHandle>(null);
  // Снимок последнего сохранённого состояния — чтобы автосохранение не дёргало сервер зря.
  const savedRef = useRef<{ title: string; content: string } | null>(null);

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
      savedRef.current = { title: d.title, content: JSON.stringify(d.contentJson) };
    }).catch(() => showToast("Не удалось загрузить документ"));
  }, [documentId, showToast]);

  // Автосохранение заголовка и текста — с задержкой, без кнопки «Сохранить».
  useEffect(() => {
    if (!doc || !documentId) return;
    const content = JSON.stringify(contentJson);
    if (savedRef.current && savedRef.current.title === title && savedRef.current.content === content) return;
    const timer = setTimeout(() => {
      api.updateDocument(documentId, { title, contentJson })
        .then((updated) => { savedRef.current = { title: updated.title, content: JSON.stringify(updated.contentJson) }; })
        .catch(() => showToast("Не удалось сохранить"));
    }, 700);
    return () => clearTimeout(timer);
  }, [title, contentJson, doc, documentId, showToast]);

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

  // Теги документа хранятся в fields.tags.
  function addTag() {
    const v = tagInput.trim();
    const cur = Array.isArray(fields.tags) ? (fields.tags as string[]) : [];
    setAddingTag(false);
    setTagInput("");
    if (!v || cur.includes(v)) return;
    patchDoc({ fields: { ...fields, tags: [...cur, v] } });
  }
  function removeTag(t: string) {
    const cur = Array.isArray(fields.tags) ? (fields.tags as string[]) : [];
    patchDoc({ fields: { ...fields, tags: cur.filter((x) => x !== t) } });
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

  // Применяет предложенную ИИ правку существующего документа (переименование/новый текст).
  async function editEntity(edit: EditEntity) {
    const target = allDocuments.find((d) => d.title.toLowerCase() === edit.title.toLowerCase());
    if (!target) { showToast(`Не найден документ «${edit.title}»`); return; }
    const patch: { title?: string; contentJson?: unknown } = {};
    if (edit.rename && edit.rename !== target.title) patch.title = edit.rename;
    if (edit.text) patch.contentJson = markdownToDoc(edit.text);
    if (patch.title === undefined && patch.contentJson === undefined) { showToast("Нечего менять"); return; }
    try {
      await api.updateDocument(target.id, patch);
      campaignCtx?.reload();
      showToast(`Обновлено: «${edit.rename ?? target.title}»`);
    } catch {
      showToast("Не удалось обновить документ");
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
  const tags = Array.isArray(fields.tags) ? (fields.tags as string[]) : [];
  const railColors = typeColors(doc.type);

  return (
    <div className="view doc-view" style={{ "--doc-accent": typeColor(doc.type) } as CSSProperties}>
      <div className="doc-grid">
        <div className="doc-main">
          <header className="doc-head">
            <span className="doc-rail" style={{ color: railColors.fg, background: railColors.bg }}>
              {t?.label ?? doc.type}
            </span>
            <div className="doc-head-body">
              <div className="doc-head-row">
                <button type="button" className="doc-back" onClick={goBack} title="Назад">
                  <ArrowLeft size={16} />
                </button>
                <input
                  id="doc-title"
                  aria-label="Заголовок"
                  className="doc-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <div className="doc-actions">
                  <button type="button" className={`icon-btn doc-bookmark${marked ? " active" : ""}`} onClick={toggleMark} title={marked ? "Убрать из закладок" : "В закладки"} aria-pressed={marked}>
                    <BookmarkIcon size={15} strokeWidth={1.8} fill={marked ? "currentColor" : "none"} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => navigate(`/campaigns/${doc.campaignId}/documents/${doc.id}/print`)} title="Печать">
                    <Printer size={15} strokeWidth={1.8} />
                  </button>
                  <ChangeTypeMenu current={doc.type} onChange={changeType} />
                  <button type="button" className="icon-btn doc-delete" onClick={() => setDeleting(true)} title="Удалить документ">
                    <Trash2 size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </div>
              <div className="doc-tags">
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
                <div className="doc-tags-right">
                  {tags.map((t) => (
                    <span key={t} className="doc-tag">
                      {t}
                      <button type="button" className="doc-tag-x" onClick={() => removeTag(t)} aria-label={`Удалить тег ${t}`}>×</button>
                    </span>
                  ))}
                  {addingTag ? (
                    <input
                      className="doc-tag-input"
                      autoFocus
                      value={tagInput}
                      placeholder="Тег…"
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addTag(); }
                        else if (e.key === "Escape") { setAddingTag(false); setTagInput(""); }
                      }}
                      onBlur={addTag}
                    />
                  ) : (
                    <button type="button" className="doc-tag-add" onClick={() => setAddingTag(true)} title="Добавить тег">
                      <Plus size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </header>

          <DocumentEditor
            ref={editorRef}
            key={documentId}
            content={contentJson}
            onChange={setContentJson}
            mentions={mentions}
          />
        </div>

        <aside className="doc-side">
          <div className="side-panel">
            <div className="panel-tabs">
              <button type="button" className={panel === "assistant" ? "active" : ""} onClick={() => setPanel("assistant")}>
                <MessageCircle size={15} strokeWidth={1.8} /> Помощник
              </button>
              <button type="button" className={panel === "play" ? "active" : ""} onClick={() => setPanel("play")}>
                <Drama size={15} strokeWidth={1.8} /> Играть
              </button>
            </div>
            {panel === "assistant" ? (
              <DocumentAssistant
                docId={doc.id}
                title={title}
                typeLabel={t?.label ?? doc.type}
                template={getTemplate(doc.type)}
                documents={allDocuments.map((d) => ({ title: d.title, type: d.type }))}
                getText={() => pmText(contentJson).trim()}
                onApply={(text) => editorRef.current?.applyText(text)}
                onCreateEntity={createEntity}
                onEditEntity={editEntity}
              />
            ) : (
              <PlayPanel documents={allDocuments} currentId={doc.id} onInsert={insertReference} />
            )}
          </div>
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
