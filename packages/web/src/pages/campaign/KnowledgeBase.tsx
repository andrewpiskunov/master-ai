import { BookOpen } from "lucide-react";
import { DocCard, KNOWLEDGE_TYPES, TypeCards, useCampaign } from "./shared.js";

export function KnowledgeBase() {
  const { documents, createDocument } = useCampaign();
  const docs = documents.filter((d) => KNOWLEDGE_TYPES.includes(d.type));
  return (
    <div className="view">
      <header className="view-head">
        <BookOpen size={24} strokeWidth={1.8} className="view-head-icon" />
        <div>
          <h1 className="page-title">База знаний</h1>
          <p className="view-sub">{docs.length} документов: лор, NPC, локации, фракции, заметки</p>
        </div>
      </header>

      <h2>По типам</h2>
      <TypeCards typeKeys={KNOWLEDGE_TYPES} documents={documents} onCreate={createDocument} />

      <h2>Документы</h2>
      {docs.length === 0 ? (
        <p className="muted">Пока пусто. Создайте документ или примите предложение ИИ в Мастерской.</p>
      ) : (
        <ul className="doc-cards grid">
          {docs.map((d) => <li key={d.id}><DocCard doc={d} /></li>)}
        </ul>
      )}
    </div>
  );
}
