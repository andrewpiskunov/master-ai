import { Layers } from "lucide-react";
import { plural } from "../../format.js";
import { PLAY_TYPES, TypedLibrary, useCampaign } from "./shared.js";

export function PlayMaterials() {
  const { documents, createDocument } = useCampaign();
  return (
    <TypedLibrary
      icon={Layers}
      title="Игровые материалы"
      subtitle={(n) => `${n} ${plural(n, ["материал", "материала", "материалов"])}: сцены, столкновения, арки, сессии, секреты, предметы`}
      typeKeys={PLAY_TYPES}
      documents={documents}
      createDocument={createDocument}
      storageKey="play-view"
    />
  );
}
