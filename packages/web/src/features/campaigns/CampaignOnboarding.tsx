import { Fragment, useMemo } from "react";
import { Link } from "react-router-dom";
import { Sparkles, BookOpen, Layers, Bookmark, Users, Shield, CalendarDays, Lightbulb, MapPin, Milestone, Check, Plus, type LucideIcon } from "lucide-react";
import { getDocumentType, type Campaign, type Document } from "@master-ai/shared";
import { WorkshopPanel, WorkshopProposals, WorldSummary } from "../assistant/WorkshopPanel.js";
import { TypeBadge } from "./shared.js";

const CREATE_ORDER = ["session", "npc", "location", "arc", "encounter", "pc", "lore", "scene", "secret", "item", "faction", "reference"];

interface FoundationStep {
  key: string;
  icons: { Icon: LucideIcon; type: string }[];
  title: string;
  counted: boolean;
  tip: string;
  doneText: string;
  cta: string;
  done: (has: (t: string) => boolean, campaign: Campaign | null) => boolean;
}

const FOUNDATION: FoundationStep[] = [
  { key: "lore", icons: [{ Icon: Bookmark, type: "lore" }], title: "Лор и тон", counted: true, cta: "Добавить лор",
    tip: "Скажите ассистенту тон, завязку или историю мира.", doneText: "В кампании уже есть стартовый контекст.",
    done: (has, c) => has("lore") || !!c?.description?.trim() },
  { key: "people", icons: [{ Icon: Users, type: "npc" }, { Icon: MapPin, type: "location" }], title: "Люди и места", counted: true, cta: "Добавить NPC",
    tip: "Добавьте, кто важен и где будет происходить действие.", doneText: "У ассистента есть лица и места для ссылок.",
    done: (has) => has("npc") || has("location") },
  { key: "party", icons: [{ Icon: Shield, type: "pc" }, { Icon: Milestone, type: "arc" }], title: "Партия и сюжет", counted: true, cta: "Добавить персонажа игрока",
    tip: "Добавьте персонажей игроков и нить, ведущую их вперёд.", doneText: "Есть партия и сюжетная нить.",
    done: (has) => has("pc") || has("arc") },
  { key: "session", icons: [{ Icon: CalendarDays, type: "session" }], title: "Первая сессия", counted: false, cta: "Создать первую сессию",
    tip: "Когда будете готовы, превратите основу в подготовку к столу.", doneText: "Первая сессия запланирована.",
    done: (has) => has("session") },
];

// Сколько из трёх ключевых шагов основы выполнено (для переключения экрана).
export function foundationDoneCount(campaign: Campaign | null, documents: Document[]): number {
  const has = (t: string) => documents.some((d) => d.type === t);
  return FOUNDATION.filter((s) => s.counted && s.done(has, campaign)).length;
}

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

  const steps = FOUNDATION.map((s) => ({ ...s, isDone: s.done(has, campaign) }));
  const counted = steps.filter((s) => s.counted);
  const done = counted.filter((s) => s.isDone).length;
  const current = counted.find((s) => !s.isDone);
  const almost = done >= counted.length - 1;

  return (
    <div className="onboard">
      <div className="onboard-top">
        <section className="panel onboard-welcome">
          {almost ? (
            <>
              <span className="onboard-badge onboard-badge-almost"><Sparkles size={13} /> Почти готово</span>
              <h2>Почти готово к подготовке сессии</h2>
              <p className="muted">
                Вы собрали бóльшую часть основы кампании.{current ? ` Добавьте недостающее — ${current.title.toLowerCase()} — чтобы подготовка оставалась связанной с тем, о чём история.` : ""}
              </p>
              <p className="muted">
                После этого пространство переключится с настройки на подготовку сессий — где можно собирать сессии и игровые материалы из уже начатой Базы знаний.
              </p>
              {current && (
                <button type="button" className="onboard-cta" onClick={() => createDocument(current.icons[0].type)}>
                  <Plus size={16} strokeWidth={2} /> {current.cta}
                </button>
              )}
              <p className="onboard-keep">Хотите доработать уже созданное?</p>
              <div className="onboard-keep-links">
                <Link to={`/campaigns/${campaignId}/workshop`}><Lightbulb size={15} /> Открыть Мастерскую</Link>
                <Link to={`/campaigns/${campaignId}/knowledge`}><BookOpen size={15} /> Открыть Базу знаний</Link>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </section>

        <section className="panel onboard-foundation">
          <div className="onboard-foundation-head">
            <h3>Основа кампании</h3>
            <span className="onboard-steps-badge">{done}/{counted.length} шага</span>
          </div>
          {steps.map((s, idx) => (
            <Fragment key={s.key}>
              {!s.counted && steps[idx - 1]?.counted && (
                <div className="onboard-foundation-then">Затем, когда основа готова</div>
              )}
            <div className={`onboard-step${s.isDone ? " done" : ""}${s === current ? " current" : ""}${s.counted ? "" : " onboard-step-later"}`}>
              <span className="onboard-step-icons">
                {s.icons.map((ic) => (
                  <button key={ic.type} type="button" className="onboard-step-ic" title={`Создать: ${getDocumentType(ic.type)?.label ?? ic.type}`} onClick={() => createDocument(ic.type)}>
                    <ic.Icon size={18} strokeWidth={1.8} />
                  </button>
                ))}
                {s.isDone && <span className="onboard-step-check"><Check size={16} strokeWidth={2.6} /></span>}
              </span>
              <span className="onboard-step-body">
                <span className="onboard-step-title">{s.title}</span>
                <span className="onboard-step-desc">{s.isDone ? s.doneText : s.tip}</span>
              </span>
            </div>
            </Fragment>
          ))}
        </section>
      </div>

      <section className="panel onboard-assistant">
        <h2 className="onboard-assistant-title"><Sparkles size={18} /> ИИ-ассистент</h2>
        <div className="onboard-assistant-grid">
          <div className="onboard-chat">
            <WorkshopPanel mentions={mentions} />
            <WorldSummary />
          </div>
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

      <nav className="onboard-nav">
        <Link to={`/campaigns/${campaignId}/workshop`} className="onboard-nav-card">
          <Lightbulb size={20} strokeWidth={1.8} />
          <span><strong>Мастерская</strong>Мозговой штурм, импорт заметок и генерация документов</span>
        </Link>
        <Link to={`/campaigns/${campaignId}/knowledge`} className="onboard-nav-card">
          <BookOpen size={20} strokeWidth={1.8} />
          <span><strong>База знаний</strong>Лор, NPC, локации, фракции и референсы</span>
        </Link>
        <Link to={`/campaigns/${campaignId}/play`} className="onboard-nav-card">
          <Layers size={20} strokeWidth={1.8} />
          <span><strong>Игровые материалы</strong>Сцены, столкновения, секреты, зацепки и предметы</span>
        </Link>
      </nav>
    </div>
  );
}
