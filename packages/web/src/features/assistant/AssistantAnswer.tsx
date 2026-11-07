import { useState, type ReactNode } from "react";
import { Check, Pencil, Plus } from "lucide-react";
import { plural } from "../../lib/format.js";
import { markdownToDoc } from "../documents/editor/DocumentEditor.js";
import { pmText } from "../../lib/prosemirror-text.js";
import { lineDiff } from "../../lib/lineDiff.js";
import { Markdown } from "../../ui/Markdown.js";
import { TypeTag } from "../campaigns/shared.js";
import { blockKey, parseAssistant, type EditEntity, type NewEntity } from "./assistant-blocks.js";

// Превью изменений блока ```doc``` относительно текущего документа: только изменённые
// строки (+/−) с короткими неизменными участками; длинные — сворачиваем.
function DiffPreview({ current, proposed }: { current: string; proposed: string }) {
  const diff = lineDiff(current, proposed);
  if (!diff.some((l) => l.type !== "same")) {
    return <div className="apply-preview apply-diff-empty">Изменений нет — текст совпадает с документом.</div>;
  }
  const rows: ({ collapse: number } | { type: "add" | "del" | "same"; text: string })[] = [];
  let sameRun: string[] = [];
  const flush = () => {
    if (sameRun.length > 3) rows.push({ collapse: sameRun.length });
    else sameRun.forEach((t) => rows.push({ type: "same", text: t }));
    sameRun = [];
  };
  for (const l of diff) {
    if (l.type === "same") sameRun.push(l.text);
    else { flush(); rows.push(l); }
  }
  flush();
  return (
    <div className="apply-preview apply-diff">
      {rows.map((r, i) => "collapse" in r
        ? <div key={i} className="diff-collapse">··· {r.collapse} {plural(r.collapse, ["строка", "строки", "строк"])} без изменений ···</div>
        : <div key={i} className={`diff-line diff-${r.type}`}><span className="diff-sign">{r.type === "add" ? "+" : r.type === "del" ? "−" : " "}</span>{r.text || " "}</div>)}
    </div>
  );
}

// Тело ответа ассистента: вступление + карточки doc/new-doc/edit-doc.
// renderIntro позволяет игровому чату отрисовать секции «Прочитай игрокам»/«Скрытое».
export function AssistantAnswer({
  content, stale, currentText, appliedBlocks, documents,
  onApply, onCreateEntity, onEditEntity, renderIntro,
}: {
  content: string;
  stale: boolean;
  currentText: string;
  appliedBlocks: string[];
  documents: { title: string; type: string }[];
  onApply: (text: string) => void;
  // Возвращают true, только если сущность реально создана/обновлена —
  // отметка «создана»/«обновлено» ставится строго по этому результату.
  onCreateEntity: (entity: NewEntity) => boolean | Promise<boolean>;
  onEditEntity: (edit: EditEntity) => boolean | Promise<boolean>;
  renderIntro?: (intro: string) => ReactNode;
}) {
  // Оптимистичные отметки «применено/создано/обновлено» — состояние на карточку-сообщение.
  const [appliedLocal, setAppliedLocal] = useState<Set<string>>(() => new Set());
  const [createdLocal, setCreatedLocal] = useState<Set<string>>(() => new Set());
  const [editedLocal, setEditedLocal] = useState<Set<string>>(() => new Set());
  const { intro, doc, newDocs, edits } = parseAssistant(content);

  const isApplied = (block: string): boolean => {
    if (appliedLocal.has(block)) return true;
    if (appliedBlocks.includes(blockKey(block))) return true;
    try { return pmText(markdownToDoc(block)).trim() === currentText; } catch { return false; }
  };
  const entityKey = (e: NewEntity) => `${e.type}:${e.title.trim().toLowerCase()}`;
  const isCreated = (nd: NewEntity): boolean =>
    createdLocal.has(entityKey(nd)) || documents.some((d) => d.title.trim().toLowerCase() === nd.title.trim().toLowerCase());
  const editKey = (e: EditEntity) => `${e.title.trim().toLowerCase()}→${(e.rename ?? "").trim().toLowerCase()}`;
  const isEdited = (e: EditEntity): boolean =>
    editedLocal.has(editKey(e)) || (!!e.rename && documents.some((d) => d.title.trim().toLowerCase() === e.rename!.trim().toLowerCase()));

  return (
    <>
      {intro && (renderIntro ? renderIntro(intro) : <Markdown>{intro}</Markdown>)}
      {doc && (
        isApplied(doc) ? (
          <div className="apply-done"><Check size={15} /> Применено к документу</div>
        ) : stale ? (
          <div className="apply-card apply-stale">
            <DiffPreview current={currentText} proposed={pmText(markdownToDoc(doc)).trim()} />
            <div className="apply-stale-note">Документ менялся после этого предложения — применение перезапишет более свежий текст.</div>
            <button type="button" className="apply-btn apply-btn-ghost" onClick={() => { onApply(doc); setAppliedLocal((s) => new Set(s).add(doc)); }}>
              Применить всё равно
            </button>
          </div>
        ) : (
          <div className="apply-card">
            <DiffPreview current={currentText} proposed={pmText(markdownToDoc(doc)).trim()} />
            <button type="button" className="apply-btn" onClick={() => { onApply(doc); setAppliedLocal((s) => new Set(s).add(doc)); }}>
              <Check size={15} /> Применить к документу
            </button>
          </div>
        )
      )}
      {newDocs.map((nd, ni) => (
        isCreated(nd) ? (
          <div className="apply-done" key={`nd-${ni}`}><Check size={15} /> Сущность «{nd.title}» создана</div>
        ) : (
          <div className="apply-card" key={`nd-${ni}`}>
            <div className="apply-head">
              <TypeTag type={nd.type} />
              <span className="apply-new-title">{nd.title}</span>
            </div>
            {nd.text && <div className="apply-preview">{nd.text}</div>}
            <button type="button" className="apply-btn" onClick={async () => { if (await onCreateEntity(nd)) setCreatedLocal((s) => new Set(s).add(entityKey(nd))); }}>
              <Plus size={15} /> Создать сущность «{nd.title}»
            </button>
          </div>
        )
      ))}
      {edits.map((e, ei) => (
        isEdited(e) ? (
          <div className="apply-done" key={ei}><Check size={15} /> «{e.rename ?? e.title}» обновлено</div>
        ) : (
          <div className="apply-card" key={ei}>
            <div className="apply-head">
              <Pencil size={14} />
              <span className="apply-new-title">{e.title}{e.rename ? ` → ${e.rename}` : ""}</span>
            </div>
            {e.text && <div className="apply-preview">{e.text}</div>}
            <button type="button" className="apply-btn" onClick={async () => { if (await onEditEntity(e)) setEditedLocal((s) => new Set(s).add(editKey(e))); }}>
              <Check size={15} /> Обновить «{e.rename ?? e.title}»
            </button>
          </div>
        )
      ))}
    </>
  );
}
