import { Layers } from "lucide-react";
import { DocCard, PLAY_TYPES, TypeCards, useCampaign } from "./shared.js";

export function PlayMaterials() {
  const { documents, createDocument } = useCampaign();
  const docs = documents.filter((d) => PLAY_TYPES.includes(d.type));
  return (
    <div className="view">
      <header className="view-head">
        <Layers size={24} strokeWidth={1.8} className="view-head-icon" />
        <div>
          <h1 className="page-title">Игровые материалы</h1>
          <p className="view-sub">{docs.length} материалов: сцены, сессии, секреты, предметы</p>
        </div>
      </header>

      <h2>По типам</h2>
      <TypeCards typeKeys={PLAY_TYPES} documents={documents} onCreate={createDocument} />

      <h2>Материалы</h2>
      {docs.length === 0 ? (
        <p className="muted">Пока пусто. Создайте материал или примите предложение ИИ в Мастерской.</p>
      ) : (
        <ul className="doc-cards grid">
          {docs.map((d) => <li key={d.id}><DocCard doc={d} /></li>)}
        </ul>
      )}
    </div>
  );
}
