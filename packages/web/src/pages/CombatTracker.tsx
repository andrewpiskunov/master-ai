import { useState } from "react";
import { Plus, X, Dices, ChevronRight, Swords, Sparkles } from "lucide-react";
import { rollDice, type DiceResult } from "../dice.js";

export interface Combatant {
  id: string;
  name: string;
  init: number;
  hp: number;
  maxHp: number;
  conditions: string;
}
export interface CombatState {
  round: number;
  turn: number;
  combatants: Combatant[];
}

const QUICK_DICE = ["d20", "d100", "d12", "d10", "d8", "d6", "d4"];

// Боевой трекер за столом: инициатива, раунды, HP/состояния и бросок кубов.
// Состояние боя персистентно (хранится в fields.combat), броски — эфемерны.
export function CombatTracker({
  combat, onChange, candidates = [], onAiFill, aiBusy = false,
}: {
  combat: CombatState | null;
  onChange: (c: CombatState | null) => void;
  candidates?: { id: string; title: string; type: string }[];
  onAiFill?: () => void;
  aiBusy?: boolean;
}) {
  const [name, setName] = useState("");
  const [init, setInit] = useState("");
  const [formula, setFormula] = useState("d20");
  const [roll, setRoll] = useState<DiceResult | null>(null);

  const state: CombatState = combat ?? { round: 1, turn: 0, combatants: [] };
  const list = state.combatants;

  const update = (next: CombatState) => onChange(next);
  const sortByInit = (cs: Combatant[]) => [...cs].sort((a, b) => b.init - a.init);

  function addNamed(rawName: string, initVal = 0) {
    const n = rawName.trim();
    if (!n) return;
    const c: Combatant = { id: crypto.randomUUID(), name: n, init: initVal, hp: 10, maxHp: 10, conditions: "" };
    update({ ...state, combatants: sortByInit([...list, c]) });
  }
  function addCombatant(e: { preventDefault: () => void }) {
    e.preventDefault();
    addNamed(name, Number(init) || 0);
    setName("");
    setInit("");
  }

  function patchCombatant(id: string, patch: Partial<Combatant>) {
    update({ ...state, combatants: sortByInit(list.map((c) => (c.id === id ? { ...c, ...patch } : c))) });
  }
  function removeCombatant(id: string) {
    const combatants = list.filter((c) => c.id !== id);
    update({ ...state, combatants, turn: Math.min(state.turn, Math.max(0, combatants.length - 1)) });
  }
  function nextTurn() {
    if (list.length === 0) return;
    const t = state.turn + 1;
    if (t >= list.length) update({ ...state, turn: 0, round: state.round + 1 });
    else update({ ...state, turn: t });
  }

  return (
    <div className="combat">
      {list.length === 0 ? (
        <div className="combat-empty">
          <Swords size={22} strokeWidth={1.8} />
          <p>Бой ещё не начался</p>
          <span>Добавьте участников — вручную, из персонажей кампании или соберите из чата с ИИ-мастером.</span>
        </div>
      ) : (
        <div className="combat-head">
          <span className="combat-round">Раунд {state.round}</span>
          <button type="button" className="combat-next" onClick={nextTurn}><ChevronRight size={15} /> Ход</button>
          <button type="button" className="combat-end" onClick={() => onChange(null)}>Завершить</button>
        </div>
      )}

      <ul className="combat-list">
        {list.map((c, i) => {
          const pct = c.maxHp > 0 ? Math.max(0, Math.min(1, c.hp / c.maxHp)) * 100 : 0;
          const hpColor = pct > 50 ? "#4ade80" : pct > 25 ? "#fbbf24" : "#f87171";
          return (
          <li key={c.id} className={`combat-row${i === state.turn ? " active" : ""}${c.hp <= 0 ? " down" : ""}`}>
            <input className="combat-init" value={c.init} onChange={(e) => patchCombatant(c.id, { init: Number(e.target.value) || 0 })} title="Инициатива" />
            <div className="combat-main">
              <span className="combat-name">{c.name}</span>
              <span className="combat-hp">
                HP
                <input className="combat-hp-in" value={c.hp} onChange={(e) => patchCombatant(c.id, { hp: Number(e.target.value) || 0 })} />
                /
                <input className="combat-hp-in" value={c.maxHp} onChange={(e) => patchCombatant(c.id, { maxHp: Number(e.target.value) || 0 })} />
                <button type="button" className="combat-dmg" title="−5 урона" onClick={() => patchCombatant(c.id, { hp: c.hp - 5 })}>−5</button>
                <button type="button" className="combat-dmg" title="−1 урона" onClick={() => patchCombatant(c.id, { hp: c.hp - 1 })}>−1</button>
                <button type="button" className="combat-heal" title="+1 лечения" onClick={() => patchCombatant(c.id, { hp: Math.min(c.maxHp, c.hp + 1) })}>+1</button>
              </span>
              <span className="combat-hpbar"><span className="combat-hpbar-fill" style={{ width: `${pct}%`, background: hpColor }} /></span>
              <input className="combat-cond" placeholder="состояния…" value={c.conditions} onChange={(e) => patchCombatant(c.id, { conditions: e.target.value })} />
            </div>
            <button type="button" className="combat-x" onClick={() => removeCombatant(c.id)} aria-label="Убрать"><X size={14} /></button>
          </li>
          );
        })}
      </ul>

      <div className="combat-section">
        <div className="combat-section-head">Участники</div>
        <form className="combat-add" onSubmit={addCombatant}>
          <input className="combat-add-name" placeholder="Имя участника" aria-label="Имя участника" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="combat-add-init" placeholder="Иниц." aria-label="Инициатива" inputMode="numeric" value={init} onChange={(e) => setInit(e.target.value)} />
          <button type="submit" className="combat-add-btn" aria-label="Добавить"><Plus size={16} /></button>
        </form>

        <div className="combat-sources">
          {candidates.length > 0 && (
            <select
              className="combat-pick"
              value=""
              onChange={(e) => { const c = candidates.find((x) => x.id === e.target.value); if (c) addNamed(c.title); e.currentTarget.value = ""; }}
              title="Добавить из существующих персонажей кампании"
            >
              <option value="">+ Из кампании…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
          {onAiFill && (
            <button type="button" className="combat-ai" onClick={onAiFill} disabled={aiBusy} title="Собрать участников боя из чата и текста сессии">
              <Sparkles size={13} /> {aiBusy ? "Собираю…" : "Из чата"}
            </button>
          )}
        </div>
      </div>

      <div className="combat-dice">
        <div className="combat-section-head">Кубы</div>
        <div className="combat-dice-quick">
          {QUICK_DICE.map((d) => (
            <button key={d} type="button" className={formula === d ? "active" : ""} onClick={() => { setFormula(d); setRoll(rollDice(d)); }}>{d}</button>
          ))}
        </div>
        <form className="combat-dice-form" onSubmit={(e) => { e.preventDefault(); setRoll(rollDice(formula)); }}>
          <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="2d6+3" aria-label="Формула броска" />
          <button type="submit"><Dices size={15} /> Бросить</button>
        </form>
        {roll && (
          <div className="combat-roll">
            <strong>{roll.total}</strong>
            <span className="combat-roll-detail">{roll.formula}: [{roll.rolls.join(", ")}]{roll.modifier ? (roll.modifier > 0 ? ` +${roll.modifier}` : ` ${roll.modifier}`) : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
