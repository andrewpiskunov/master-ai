import { useState } from "react";
import { Plus } from "lucide-react";
import { getDocumentType, type Document } from "@master-ai/shared";
import { TypeBadge } from "./campaign/shared.js";

// Вкладки игровых материалов — как «Play Material» в Campaign Arks.
const PLAY_TABS = ["scene", "encounter", "secret", "item"];

export function PlayPanel({
  documents,
  currentId,
  onInsert,
}: {
  documents: Document[];
  currentId: string;
  onInsert: (doc: Document) => void;
}) {
  const [tab, setTab] = useState("scene");
  const items = documents.filter((d) => d.type === tab && d.id !== currentId);
  const tabDef = getDocumentType(tab);

  return (
    <aside className="panel doc-play">
      <div className="play-tabs">
        {PLAY_TABS.map((t) => {
          const def = getDocumentType(t);
          return (
            <button key={t} type="button" className={`play-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              <TypeBadge type={t} size={20} />
              <span>{def?.label ?? t}</span>
            </button>
          );
        })}
      </div>
      <div className="play-list">
        {items.length === 0 ? (
          <p className="muted play-empty">Нет материалов «{tabDef?.label ?? tab}». Создайте их в Игровых материалах или Мастерской.</p>
        ) : (
          items.map((d) => (
            <button key={d.id} type="button" className="play-item" onClick={() => onInsert(d)} title="Вставить ссылку в документ">
              <TypeBadge type={d.type} size={24} />
              <span className="play-item-title">{d.title}</span>
              <Plus size={15} className="play-item-add" />
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
