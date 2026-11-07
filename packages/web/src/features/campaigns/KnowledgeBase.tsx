import { BookOpen } from "lucide-react";
import { plural } from "../../lib/format.js";
import { KNOWLEDGE_TYPES, TypedLibrary, useCampaign } from "./shared.js";

export function KnowledgeBase() {
  const { documents, createDocument } = useCampaign();
  return (
    <TypedLibrary
      icon={BookOpen}
      title="База знаний"
      subtitle={(n) => `${n} ${plural(n, ["документ", "документа", "документов"])}: персонажи, NPC, локации, фракции, лор, референсы, заметки`}
      typeKeys={KNOWLEDGE_TYPES}
      documents={documents}
      createDocument={createDocument}
      storageKey="kb-view"
    />
  );
}
