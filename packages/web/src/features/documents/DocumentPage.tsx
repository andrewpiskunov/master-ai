import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, Bookmark as BookmarkIcon, Printer, EyeOff, MessageCircle, Layers, Link2, Plus, Check, Loader, Image as ImageIcon } from "lucide-react";
import { getDocumentType, getTemplate, statusLabel, DISPOSITIONS, getDisposition, hasDisposition, type Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { DocumentEditor, markdownToDoc, type DocumentEditorHandle } from "./editor/DocumentEditor.js";
import { useGoBack } from "../../hooks/useGoBack.js";
import { useToast } from "../../ui/toast.js";
import { Select } from "../../ui/Select.js";
import { Modal } from "../../ui/Modal.js";
import { DocumentImages } from "../images/DocumentImages.js";
import { ImagePreview } from "../images/ImageViewer.js";
import { DocumentAssistant } from "../assistant/DocumentAssistant.js";
import { blockKey, type NewEntity, type EditEntity } from "../assistant/assistant-blocks.js";
import { PlayPanel } from "../play/PlayPanel.js";
import { MentionedInPanel } from "./MentionedInPanel.js";
import { ChangeTypeMenu, typeColor, typeColors, useCampaign } from "../campaigns/shared.js";
import { isBookmarked, toggleBookmark } from "../../hooks/useBookmarks.js";
import { pmText } from "../../lib/prosemirror-text.js";
import { streamComplete } from "../../api/stream.js";

// Извлекает блок полей раздела из markdown-шаблона (строки под «## Заголовок» до следующего «## »).
function sectionFieldBlock(template: string, heading: string): string {
  const lines = template.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading.trim()}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
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
  // Предложение ИИ создать сущность, совпавшую по имени и типу с существующей.
  const [dupEntity, setDupEntity] = useState<NewEntity | null>(null);
  const [panel, setPanel] = useState<"assistant" | "play" | "mentions" | "images">("assistant");
  // Одноразовая подсказка о назначении вкладок правой панели.
  const [tabsHint, setTabsHint] = useState(() => {
    try { return localStorage.getItem("master-ai:doc-tabs-hint-seen") !== "1"; } catch { return true; }
  });
  const [marked, setMarked] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const editorRef = useRef<DocumentEditorHandle>(null);
  // Актуальные fields для обработчиков, которые могут сработать до ре-рендера
  // (например, два применения doc-блоков подряд) — иначе второй PATCH затрёт ключ первого.
  const fieldsRef = useRef<Record<string, unknown>>({});
  useEffect(() => { fieldsRef.current = fields; }, [fields]);
  // Снимок последнего сохранённого состояния — чтобы автосохранение не дёргало сервер зря.
  const savedRef = useRef<{ title: string; content: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [fillingHeading, setFillingHeading] = useState<string | null>(null);
  const currentDocumentId = useRef(documentId);
  currentDocumentId.current = documentId;
  const imageRefreshVersion = useRef(0);
  const [imagesRevision, setImagesRevision] = useState(0);
  const documentVisit = useRef(0);
  useEffect(() => { imageRefreshVersion.current++; documentVisit.current++; }, [documentId]);
  const pageActive = useRef(true);
  useEffect(() => {
    pageActive.current = true;
    return () => { pageActive.current = false; };
  }, []);

  // Обновляем только метаданные изображения: серверный ответ не заменяет черновик.
  function applyImageDocument(updated: Document) {
    if (!pageActive.current || currentDocumentId.current !== updated.id) return;
    imageRefreshVersion.current++;
    function mergeAvatarField(current: Record<string, unknown>) {
      const next = { ...current };
      delete next.avatarImageId;
      if (typeof updated.fields?.avatarImageId === "string") next.avatarImageId = updated.fields.avatarImageId;
      return next;
    }
    fieldsRef.current = mergeAvatarField(fieldsRef.current);
    setFields((current) => mergeAvatarField(current));
    setDoc((current) => current?.id === updated.id ? { ...current, avatar: updated.avatar, fields: mergeAvatarField(current.fields ?? {}) } : current);
    campaignCtx?.reload();
  }

  async function refreshImageDocument(refreshGallery = false) {
    const id = documentId;
    if (!id) return;
    const version = ++imageRefreshVersion.current;
    try {
      const updated = await api.getDocument(id);
      if (!pageActive.current || currentDocumentId.current !== id || version !== imageRefreshVersion.current) return;
      applyImageDocument(updated);
      if (refreshGallery) setImagesRevision((value) => value + 1);
    } catch {
      if (pageActive.current && currentDocumentId.current === id && version === imageRefreshVersion.current) showToast("Не удалось обновить аватар");
    }
  }

  function mutationVersion() { return { image: imageRefreshVersion.current, visit: documentVisit.current }; }
  // Full-document responses can arrive after an avatar change. Apply their
  // ordinary fields while retaining the newer avatar already shown in the UI.
  function applySavedDocument(updated: Document, started: ReturnType<typeof mutationVersion>): boolean {
    if (!pageActive.current || currentDocumentId.current !== updated.id || started.visit !== documentVisit.current) return false;
    const retainAvatar = started.image !== imageRefreshVersion.current;
    const nextFields = { ...updated.fields };
    if (retainAvatar) {
      delete nextFields.avatarImageId;
      if (typeof fieldsRef.current.avatarImageId === "string") nextFields.avatarImageId = fieldsRef.current.avatarImageId;
    }
    fieldsRef.current = nextFields;
    setFields(nextFields);
    setDoc((current) => current?.id === updated.id ? { ...updated, fields: nextFields, ...(retainAvatar ? { avatar: current.avatar } : {}) } : current);
    setStatus(updated.status ?? "");
    return true;
  }

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
    let active = true;
    api.getDocument(documentId).then((d) => {
      if (!active) return;
      setDoc(d);
      setTitle(d.title);
      setStatus(d.status ?? "");
      setContentJson(d.contentJson);
      setFields(d.fields ?? {});
      savedRef.current = { title: d.title, content: JSON.stringify(d.contentJson) };
    }).catch(() => { if (active) showToast("Не удалось загрузить документ"); });
    return () => { active = false; };
  }, [documentId, showToast]);

  // Автосохранение заголовка и текста — с задержкой, без кнопки «Сохранить».
  useEffect(() => {
    if (!doc || !documentId) return;
    const content = JSON.stringify(contentJson);
    if (savedRef.current && savedRef.current.title === title && savedRef.current.content === content) return;
    const timer = setTimeout(() => {
      setSaveState("saving");
      api.updateDocument(documentId, { title, contentJson })
        .then((updated) => { savedRef.current = { title: updated.title, content: JSON.stringify(updated.contentJson) }; setSaveState("saved"); })
        .catch(() => { showToast("Не удалось сохранить"); setSaveState("idle"); });
    }, 700);
    return () => clearTimeout(timer);
  }, [title, contentJson, doc, documentId, showToast]);

  // Мгновенно сохраняет «тег» (статус, отношение, пометку) — как в Arks, без кнопки «Сохранить».
  async function patchDoc(p: { status?: string | null; fields?: Record<string, unknown> }) {
    if (!documentId) return;
    const started = mutationVersion();
    try {
      const updated = await api.updateDocument(documentId, p);
      if (!applySavedDocument(updated, started)) return;
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

  // Применяет блок ```doc``` от ассистента: контент и персистентная отметка «применено»
  // уходят одним PATCH — ключ не теряется при быстрой навигации и повторных применениях
  // (автосохранение с задержкой 700 мс для этого недостаточно надёжно).
  async function applyDocBlock(text: string) {
    if (!documentId) return;
    const started = mutationVersion();
    editorRef.current?.applyText(text);
    const prevFields = fieldsRef.current;
    const prev = (prevFields.appliedDocBlocks as string[] | undefined) ?? [];
    const key = blockKey(text);
    const nextFields = prev.includes(key) ? prevFields : { ...prevFields, appliedDocBlocks: [...prev, key] };
    fieldsRef.current = nextFields;
    setFields(nextFields);
    showToast("Текст применён");
    try {
      const updated = await api.updateDocument(documentId, { contentJson: markdownToDoc(text), fields: nextFields });
      if (!applySavedDocument(updated, started)) return;
      savedRef.current = { title: updated.title, content: JSON.stringify(updated.contentJson) };
      setSaveState("saved");
      campaignCtx?.reload();
    } catch {
      showToast("Не удалось сохранить");
    }
  }

  // Создаёт новую сущность по предложению ИИ и связывает её с текущим документом.
  // При совпадении имени и типа с существующим документом спрашивает, а не плодит дубликат.
  async function createEntity(entity: NewEntity, force = false): Promise<boolean> {
    if (!doc) return false;
    const type = getDocumentType(entity.type) ? entity.type : "note";
    const existing = allDocuments.find(
      (d) => d.type === type && d.title.trim().toLowerCase() === entity.title.trim().toLowerCase(),
    );
    if (existing && !force) { setDupEntity(entity); return false; }
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
      return true;
    } catch {
      showToast("Не удалось создать сущность");
      return false;
    }
  }

  // Применяет предложенную ИИ правку существующего документа (переименование/новый текст).
  async function editEntity(edit: EditEntity): Promise<boolean> {
    const target = allDocuments.find((d) => d.title.toLowerCase() === edit.title.toLowerCase());
    if (!target) { showToast(`Не найден документ «${edit.title}»`); return false; }
    const patch: { title?: string; contentJson?: unknown } = {};
    if (edit.rename && edit.rename !== target.title) patch.title = edit.rename;
    if (edit.text) patch.contentJson = markdownToDoc(edit.text);
    if (patch.title === undefined && patch.contentJson === undefined) { showToast("Нечего менять"); return false; }
    try {
      await api.updateDocument(target.id, patch);
      campaignCtx?.reload();
      showToast(`Обновлено: «${edit.rename ?? target.title}»`);
      return true;
    } catch {
      showToast("Не удалось обновить документ");
      return false;
    }
  }

  // Предыдущая сессия — с наибольшим номером меньше текущего (для пересказа «Что было в прошлый раз»).
  function previousSession(): Document | undefined {
    if (!doc || doc.type !== "session") return undefined;
    const curNum = typeof doc.fields?.sessionNumber === "number" ? doc.fields.sessionNumber : Infinity;
    return allDocuments
      .filter((d) => d.type === "session" && d.id !== doc.id && (typeof d.fields?.sessionNumber === "number" ? d.fields.sessionNumber : 0) < curNum)
      .sort((a, b) => (Number(b.fields?.sessionNumber ?? 0)) - (Number(a.fields?.sessionNumber ?? 0)))[0];
  }

  // «Заполнить с ИИ» один раздел: стримим содержимое и точечно заменяем раздел в редакторе.
  async function fillSection(heading: string) {
    if (!doc) return;
    const typeLabel = getDocumentType(doc.type)?.label ?? doc.type;
    const brief = campaignCtx?.campaign?.description?.trim();
    const block = sectionFieldBlock(getTemplate(doc.type) ?? "", heading);
    // Раздел-пересказ сессии заполняем из лога предыдущей сессии, а не по шаблону.
    const isRecap = doc.type === "session" && /что было в прошлый раз/i.test(heading);
    const prev = isRecap ? previousSession() : undefined;
    if (isRecap && !prev) { showToast("Нет предыдущей сессии для пересказа"); return; }
    showToast(`ИИ заполняет раздел «${heading}»…`);
    setFillingHeading(heading);
    let out = "";
    try {
      const system = prev
        ? `Ты — соавтор мастера настольных ролевых игр. Составь краткий пересказ «Что было в прошлый раз» ` +
          `для начала сессии «${title}» по логу и заметкам ПРЕДЫДУЩЕЙ сессии «${prev.title}». ` +
          `3–5 предложений: ключевые события, решения игроков, незакрытые нити и клиффхэнгер. ` +
          `Без списков и заголовков, живым языком, по-русски. Упоминай сущности их точными названиями. ` +
          `Верни ЛИШЬ текст пересказа, без строки «## ${heading}».` +
          `\n\nЛог предыдущей сессии:\n${(typeof prev.fields?.sessionLog === "string" ? prev.fields.sessionLog : "") || "(пусто)"}` +
          `\n\nТекст предыдущей сессии:\n${pmText(prev.contentJson).trim() || "(пусто)"}`
        : `Ты — соавтор мастера настольных ролевых игр. Заполни ТОЛЬКО раздел «${heading}» документа ` +
          `(тип: ${typeLabel}, название: «${title}»). Верни ЛИШЬ содержимое раздела — подписи полей и вписанные значения; ` +
          `НЕ повторяй строку заголовка «## ${heading}». Пиши по-русски, кратко и по делу, в тоне кампании. ` +
          `Учитывай остальной текст документа, чтобы не противоречить ему.` +
          (brief ? `\n\nБриф кампании:\n${brief}` : "") +
          (block ? `\n\nСтруктура раздела (заполни по ней, сохраняя подписи полей):\n${block}` : "") +
          `\n\nВесь текущий текст документа:\n${pmText(contentJson).trim() || "(пусто)"}`;
      await streamComplete(
        {
          system,
          messages: [{ role: "user", content: `Заполни раздел «${heading}».` }],
          campaignId: doc.campaignId,
        },
        (chunk) => { out += chunk; },
      );
      if (!out.trim()) { showToast("ИИ не вернул текст"); return; }
      if (editorRef.current?.applySection(heading, out.trim())) showToast(`Раздел «${heading}» заполнен`);
      else showToast(`Не удалось найти раздел «${heading}»`);
    } catch {
      showToast("Не удалось заполнить раздел");
    } finally {
      setFillingHeading(null);
    }
  }

  // Меняет тип документа (как «Change type» в Arks); статус сервер сбросит при несовместимости.
  async function changeType(type: string) {
    if (!documentId) return;
    const started = mutationVersion();
    try {
      const updated = await api.updateDocument(documentId, { type });
      if (!applySavedDocument(updated, started)) return;
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

  if (!doc || doc.id !== documentId) return <div className="view"><p className="muted">…</p></div>;

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
            <div className="doc-avatar-block">
              {doc.avatar
                ? <ImagePreview key={`${doc.id}:${doc.avatar.id}`} images={[doc.avatar]} thumbnailSize={128} className="doc-avatar" label={`Открыть аватар ${title}`} />
                : <button type="button" className="doc-avatar doc-avatar-placeholder" aria-label="Добавить аватар" onClick={() => setPanel("images")}><ImageIcon size={24} strokeWidth={1.4} /><span>Аватар</span></button>}
              {doc.avatar && <button type="button" className="doc-avatar-change" onClick={() => setPanel("images")}>Изменить аватар</button>}
            </div>
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
                  {saveState !== "idle" && (
                    <span className={`save-status save-${saveState}`}>
                      {saveState === "saving"
                        ? <><Loader size={13} className="spin" /> Сохранение…</>
                        : <><Check size={13} strokeWidth={2.4} /> Сохранено</>}
                    </span>
                  )}
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
                {doc.type === "session" && (
                  <input
                    type="date"
                    className="session-date-input"
                    value={typeof fields.sessionDate === "string" ? fields.sessionDate : ""}
                    onChange={(e) => patchDoc({ fields: { ...fields, sessionDate: e.target.value || undefined } })}
                    aria-label="Дата сессии"
                    title="Дата сессии"
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
            campaignId={doc.campaignId}
            onOpenMention={(title) => {
              const target = allDocuments.find(
                (d) => d.id !== doc.id && d.title.trim().toLowerCase() === title.trim().toLowerCase(),
              );
              if (target) navigate(`/campaigns/${target.campaignId}/documents/${target.id}`);
            }}
            onFillSection={fillSection}
            fillingHeading={fillingHeading}
          />
        </div>

        <aside className="doc-side">
          <div className="side-panel">
            <div className="panel-tabs">
              <button type="button" className={panel === "assistant" ? "active" : ""} onClick={() => setPanel("assistant")} title="ИИ дописывает, переписывает и создаёт сущности по этому документу">
                <MessageCircle size={15} strokeWidth={1.8} /> Помощник
              </button>
              <button type="button" className={panel === "play" ? "active" : ""} onClick={() => setPanel("play")} title="Быстрые ссылки на игровые материалы для вставки в текст">
                <Layers size={15} strokeWidth={1.8} /> Материалы
              </button>
              <button type="button" className={panel === "mentions" ? "active" : ""} onClick={() => setPanel("mentions")} title="Где ещё упоминается этот документ">
                <Link2 size={15} strokeWidth={1.8} /> Связи
              </button>
              <button type="button" className={panel === "images" ? "active" : ""} onClick={() => setPanel("images")} title="Изображения и иллюстрации сущности">
                <ImageIcon size={15} strokeWidth={1.8} /> Изображения
              </button>
            </div>
            {tabsHint && (
              <div className="panel-tabs-hint">
                <span>
                  {panel === "assistant" ? "Помощник ИИ: дописывает, переписывает и создаёт сущности по этому документу."
                    : panel === "play" ? "Материалы: ссылки на сцены, столкновения, секреты и предметы для вставки в текст."
                    : panel === "images" ? "Изображения: прикрепите референсы или создайте иллюстрацию через Codex."
                    : "Связи: документы кампании, где упоминается этот."}
                </span>
                <button type="button" className="panel-tabs-hint-x" aria-label="Скрыть подсказку" onClick={() => { setTabsHint(false); try { localStorage.setItem("master-ai:doc-tabs-hint-seen", "1"); } catch { /* приватный режим */ } }}>×</button>
              </div>
            )}
            {/* Помощник не размонтируется при смене вкладки (прячется через display:none) —
                иначе переключение на «Материалы»/«Связи» обрывало бы идущую генерацию ИИ. */}
            <div className="panel-keepalive" style={{ display: panel === "assistant" ? undefined : "none" }}>
              <DocumentAssistant
                docId={doc.id}
                campaignId={doc.campaignId}
                title={title}
                typeLabel={t?.label ?? doc.type}
                template={getTemplate(doc.type)}
                documents={allDocuments.map((d) => ({ title: d.title, type: d.type }))}
                campaignBrief={campaignCtx?.campaign?.description ?? undefined}
                getText={() => pmText(contentJson).trim()}
                appliedBlocks={(fields.appliedDocBlocks as string[] | undefined) ?? []}
                docUpdatedAt={(fields.contentUpdatedAt as string | undefined) ?? doc.updatedAt}
                onApply={applyDocBlock}
                onCreateEntity={createEntity}
                onEditEntity={editEntity}
                onImagesChange={() => { void refreshImageDocument(true); }}
                // У сессий беседа общая с режимом игры, в мета-полях — лог событий: предупреждаем.
                clearConfirmText={doc.type === "session" ? "Удалится и игровой чат с логом событий — точно?" : undefined}
              />
            </div>
            {panel === "images" && <DocumentImages docId={doc.id} campaignId={doc.campaignId} title={title} typeLabel={t?.label ?? doc.type} description={pmText(contentJson).trim()} avatar={doc.avatar} selectedAvatarId={typeof fields.avatarImageId === "string" ? fields.avatarImageId : null} refreshKey={imagesRevision} onDocumentChange={applyImageDocument} onImagesChange={() => { void refreshImageDocument(); }} />}
            {panel === "play" && <PlayPanel documents={allDocuments} currentId={doc.id} onInsert={insertReference} />}
            {panel === "mentions" && <MentionedInPanel campaignId={doc.campaignId} documentId={doc.id} title={title} documents={allDocuments} />}
          </div>
        </aside>
      </div>

      {dupEntity && (
        <Modal title="Такая сущность уже есть" onClose={() => setDupEntity(null)}>
          <p className="muted">
            В кампании уже есть «{dupEntity.title}» ({getDocumentType(dupEntity.type)?.label ?? dupEntity.type}).
            Открыть её или всё-таки создать дубликат?
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                const target = allDocuments.find(
                  (d) => d.title.trim().toLowerCase() === dupEntity.title.trim().toLowerCase(),
                );
                setDupEntity(null);
                if (target) navigate(`/campaigns/${target.campaignId}/documents/${target.id}`);
              }}
            >
              Открыть существующую
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { const e = dupEntity; setDupEntity(null); void createEntity(e, true); }}
            >
              Всё равно создать
            </button>
          </div>
        </Modal>
      )}

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
