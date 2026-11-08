import { useEffect, useRef, useState } from "react";
import type { Document } from "@master-ai/shared";
import { api, ApiError } from "../../api/client.js";
import { documentHref } from "../../lib/document-links.js";
import { pmText } from "../../lib/prosemirror-text.js";
import { Modal } from "../../ui/Modal.js";
import { useToast } from "../../ui/toast.js";
import { TypeTag } from "../campaigns/shared.js";
import { markdownToDoc } from "../documents/editor/DocumentEditor.js";
import { DiffPreview } from "../assistant/AssistantAnswer.js";
import type { EditEntity } from "../assistant/assistant-blocks.js";
import "./GameEntityEdits.css";

interface Scope { campaignId?: string; sessionId?: string; active: boolean }
interface Operation { scope: Scope; resolve: (saved: boolean) => void }
interface Review { operation: Operation; target: Document; edit: EditEntity; error?: string }
const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось сохранить карточку";
const normalize = (title: string) => title.trim().toLocaleLowerCase("ru");

// The returned promise completes only after the actual save or cancellation, so
// AssistantAnswer never marks a proposed edit as applied just for opening a review.
export function useGameEntityEdits({ campaignId, sessionId, onSaved }: {
  campaignId?: string; sessionId?: string; onSaved: (document: Document) => void;
}) {
  const { showToast } = useToast();
  const [review, setReview] = useState<Review | null>(null);
  const [saving, setSaving] = useState(false);
  const operation = useRef<Operation | null>(null);
  const savedRef = useRef(onSaved); savedRef.current = onSaved;
  const scopeRef = useRef<Scope>({ campaignId, sessionId, active: true });
  if (scopeRef.current.campaignId !== campaignId || scopeRef.current.sessionId !== sessionId) {
    scopeRef.current.active = false;
    operation.current?.resolve(false); operation.current = null;
    scopeRef.current = { campaignId, sessionId, active: true };
  }
  const scope = scopeRef.current;
  const current = (op: Operation) => scope.active && scopeRef.current === scope && operation.current === op;
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      if (operation.current?.scope === scope) { operation.current.resolve(false); operation.current = null; }
    };
  }, [scope]);
  function finish(op: Operation, saved: boolean) {
    if (current(op)) { operation.current = null; setReview(null); setSaving(false); }
    op.resolve(saved);
  }
  function requestEdit(edit: EditEntity): Promise<boolean> {
    if (!campaignId || !sessionId || !scope.active || operation.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      const op: Operation = { scope, resolve }; operation.current = op;
      void (async () => {
        try {
          const documents = await api.listCampaignDocuments(campaignId);
          if (!current(op)) { finish(op, false); return; }
          const matches = documents.filter((d) => d.campaignId === campaignId && (edit.documentId ? d.id === edit.documentId : normalize(d.title) === normalize(edit.title)));
          if (!matches.length) throw new Error(`Не найден документ «${edit.title}» в этой кампании`);
          if (matches.length > 1) throw new Error(`Найдено несколько карточек «${edit.title}». Попросите ИИ указать id нужной карточки.`);
          const target = await api.getDocument(matches[0].id);
          if (!current(op)) { finish(op, false); return; }
          if (target.campaignId !== campaignId || target.id !== matches[0].id) throw new Error("Карточка не принадлежит этой кампании");
          if (!edit.text && (!edit.rename?.trim() || edit.rename === target.title)) { showToast("Нечего менять"); finish(op, false); return; }
          setSaving(false); setReview({ operation: op, target, edit });
        } catch (error) {
          if (current(op)) showToast(message(error));
          finish(op, false);
        }
      })();
    });
  }
  async function save() {
    if (!review || saving || !current(review.operation)) return;
    const { target, edit, operation: op } = review;
    const patch = {
      ...(edit.rename?.trim() && edit.rename.trim() !== target.title ? { title: edit.rename.trim() } : {}),
      ...(edit.text ? { contentJson: markdownToDoc(edit.text) } : {}),
      expectedUpdatedAt: target.updatedAt,
    };
    setSaving(true);
    try {
      const updated = await api.updateDocument(target.id, patch);
      if (!current(op)) { finish(op, false); return; }
      if (updated.id !== target.id || updated.campaignId !== campaignId) throw new Error("Сервер вернул другую карточку");
      savedRef.current(updated);
      showToast(`Обновлено: «${updated.title}»`);
      finish(op, true);
    } catch (error) {
      if (!current(op)) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await api.getDocument(target.id);
          if (!current(op)) return;
          if (latest.campaignId !== campaignId || latest.id !== target.id) throw new Error("Карточка не принадлежит этой кампании");
          setReview({ ...review, target: latest, error: "Карточка изменилась в другом окне. Проверьте обновлённую разницу и сохраните ещё раз." });
        } catch (refreshError) { if (current(op)) setReview({ ...review, error: message(refreshError) }); }
      } else setReview({ ...review, error: message(error) });
    } finally { if (current(op)) setSaving(false); }
  }
  const active = review && current(review.operation) ? review : null;
  const cancel = () => { if (active && !saving) finish(active.operation, false); };
  const dialog = active ? <Modal title="Изменить карточку" className="game-edit-modal" onClose={cancel}>
    <div className="game-edit-target"><TypeTag type={active.target.type} /><a href={documentHref(active.target.campaignId, active.target.id)} target="_blank" rel="noopener noreferrer">{active.target.title}</a></div>
    {active.edit.rename && active.edit.rename !== active.target.title && <p className="game-edit-rename">{active.target.title} <span>→</span> <strong>{active.edit.rename}</strong></p>}
    {active.error && <p className="game-edit-error" role="alert">{active.error}</p>}
    {active.edit.text ? <DiffPreview current={pmText(active.target.contentJson).trim()} proposed={pmText(markdownToDoc(active.edit.text)).trim()} /> : <p className="muted">Меняется только название. Содержимое карточки сохранится.</p>}
    <div className="modal-actions"><button type="button" onClick={() => { void save(); }} disabled={saving}>{saving ? "Сохранение…" : "Сохранить изменения"}</button><button type="button" className="btn-ghost" onClick={cancel} disabled={saving}>Отмена</button></div>
  </Modal> : null;
  return { requestEdit, dialog };
}
