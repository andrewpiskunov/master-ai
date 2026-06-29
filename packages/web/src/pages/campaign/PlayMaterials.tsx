import { Layers } from "lucide-react";
import { PLAY_TYPES, TypeCards, TypeSection, useCampaign } from "./shared.js";

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

      <TypeCards typeKeys={PLAY_TYPES} documents={documents} onCreate={createDocument} />

      {docs.length === 0 ? (
        <p className="muted">Пока пусто. Создайте материал или примите предложение ИИ в Мастерской.</p>
      ) : (
        PLAY_TYPES.map((type) => <TypeSection key={type} type={type} documents={documents} />)
      )}
    </div>
  );
}
