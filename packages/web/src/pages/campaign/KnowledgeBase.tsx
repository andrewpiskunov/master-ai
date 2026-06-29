import { BookOpen } from "lucide-react";
import { plural } from "../../format.js";
import { KNOWLEDGE_TYPES, TypeCards, TypeSection, useCampaign } from "./shared.js";

export function KnowledgeBase() {
  const { documents, createDocument } = useCampaign();
  const docs = documents.filter((d) => KNOWLEDGE_TYPES.includes(d.type));
  return (
    <div className="view">
      <header className="view-head">
        <BookOpen size={24} strokeWidth={1.8} className="view-head-icon" />
        <div>
          <h1 className="page-title">База знаний</h1>
          <p className="view-sub">{docs.length} {plural(docs.length, ["документ", "документа", "документов"])}: лор, NPC, локации, фракции, референсы, заметки</p>
        </div>
      </header>

      <TypeCards typeKeys={KNOWLEDGE_TYPES} documents={documents} onCreate={createDocument} />

      {docs.length === 0 ? (
        <p className="muted">Пока пусто. Создайте документ или примите предложение ИИ в Мастерской.</p>
      ) : (
        KNOWLEDGE_TYPES.map((type) => <TypeSection key={type} type={type} documents={documents} />)
      )}
    </div>
  );
}
