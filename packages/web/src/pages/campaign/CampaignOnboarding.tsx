import { useMemo } from "react";
import { Sparkles, BookOpen, Layers, Bookmark, Users, Shield, CalendarDays, Plus } from "lucide-react";
import { getDocumentType, type Campaign, type Document } from "@master-ai/shared";
import { WorkshopPanel, WorkshopProposals } from "../WorkshopPanel.js";
import { TypeBadge } from "./shared.js";

const CREATE_ORDER = ["session", "npc", "location", "arc", "encounter", "pc", "lore", "scene", "secret", "item", "faction", "reference"];

// Стартовый экран только что созданной кампании: шаги наполнения + чат с ИИ.
export function CampaignOnboarding({
  campaignId, campaign, documents, createDocument,
}: {
  campaignId: string;
  campaign: Campaign | null;
  documents: Document[];
  createDocument: (type: string) => void;
}) {
  const has = (type: string) => documents.some((d) => d.type === type);
  const mentions = useMemo(
    () => documents.map((d) => ({ title: d.title, type: d.type, href: `/campaigns/${campaignId}/documents/${d.id}` })),
    [documents, campaignId],
  );

  const steps = [
    { key: "lore", icon: Bookmark, title: "Лор и тон", desc: "Задайте ассистенту тон, завязку и историю мира.", create: "lore", done: has("lore") || !!campaign?.description?.trim() },
    { key: "people", icon: Users, title: "Люди и места", desc: "Добавьте, кто важен и где будет происходить действие.", create: "npc", done: has("npc") || has("location") },
    { key: "party", icon: Shield, title: "Партия и сюжет", desc: "Добавьте персонажей игроков и нить, что ведёт их вперёд.", create: "pc", done: has("pc") || has("arc") },
    { key: "session", icon: CalendarDays, title: "Первая сессия", desc: "Когда будете готовы, превратите основу в подготовку к столу.", create: "session", done: has("session") },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="onboard">
      <div className="onboard-top">
        <section className="panel onboard-welcome">
          <span className="onboard-badge"><Sparkles size={13} /> Настройка кампании</span>
          <h2>Добро пожаловать в мастерскую кампании</h2>
          <p className="muted">
            Здесь ваши заметки, идеи и подготовка превращаются в то, что можно использовать за столом.
            Необязательно продумывать всю кампанию сразу.
          </p>
          <div className="onboard-point">
            <BookOpen size={18} className="onboard-point-icon" />
            <div>
              <strong>Сначала заземлите мир в Базе знаний</strong>
              <p className="muted">Лор, NPC, локации, персонажи игроков и арки дают ассистенту контекст для понимания кампании.</p>
            </div>
          </div>
          <div className="onboard-point">
            <Layers size={18} className="onboard-point-icon" />
            <div>
              <strong>Потом соберите Игровые материалы</strong>
              <p className="muted">Сессии, сцены, столкновения, секреты и награды опираются на эту основу — подготовка остаётся связанной с миром.</p>
            </div>
          </div>
        </section>

        <section className="panel onboard-foundation">
          <div className="onboard-foundation-head">
            <h3>Основа кампании</h3>
            <span className="onboard-steps-badge">{done}/{steps.length} шагов</span>
          </div>
          {steps.map((s) => (
            <button key={s.key} type="button" className={`onboard-step${s.done ? " done" : ""}`} onClick={() => createDocument(s.create)}>
              <span className="onboard-step-icon"><s.icon size={18} strokeWidth={1.8} /></span>
              <span className="onboard-step-body">
                <span className="onboard-step-title">{s.title}</span>
                <span className="onboard-step-desc">{s.desc}</span>
              </span>
            </button>
          ))}
        </section>
      </div>

      <section className="panel onboard-assistant">
        <h2 className="onboard-assistant-title"><Sparkles size={18} /> ИИ-ассистент</h2>
        <div className="onboard-assistant-grid">
          <div className="onboard-chat"><WorkshopPanel mentions={mentions} /></div>
          <div className="onboard-side">
            <WorkshopProposals />
            <div className="onboard-quick">
              <h3>Быстрое создание</h3>
              <div className="onboard-quick-grid">
                {CREATE_ORDER.map((key) => {
                  const t = getDocumentType(key);
                  if (!t) return null;
                  return (
                    <button key={key} type="button" className="quick-create-item" onClick={() => createDocument(key)}>
                      <TypeBadge type={key} size={20} /><span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
