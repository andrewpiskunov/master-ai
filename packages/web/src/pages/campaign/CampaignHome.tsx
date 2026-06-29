import { Link } from "react-router-dom";
import { KNOWLEDGE_TYPES, PLAY_TYPES, RecentlyCreated, TypeCards, useCampaign } from "./shared.js";

export function CampaignHome() {
  const { campaign, documents, createDocument } = useCampaign();
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1 className="page-title">{campaign?.name ?? "…"}</h1>
          <p className="view-sub">Рабочее пространство кампании</p>
        </div>
      </header>

      <div className="home-grid">
        <section className="panel">
          <h2>С чего начать</h2>
          <p className="muted">
            Опишите идею в Мастерской — ИИ ответит, задаст вопросы и предложит NPC, локации,
            секреты и сцены. Принятые предложения попадают в Базу знаний и Игровые материалы.
          </p>
          <div className="home-actions">
            <Link className="btn" to="workshop">Открыть Мастерскую</Link>
            <Link className="btn btn-ghost" to="knowledge">База знаний</Link>
          </div>
        </section>
        <RecentlyCreated documents={documents} />
      </div>

      <h2>Быстрое создание</h2>
      <TypeCards typeKeys={[...KNOWLEDGE_TYPES, ...PLAY_TYPES]} documents={documents} onCreate={createDocument} />
    </div>
  );
}
