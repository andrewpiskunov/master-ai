export interface DiceResult {
  formula: string;
  rolls: number[];
  modifier: number;
  total: number;
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

// Разбор и бросок формулы вида «2d6+3», «d20», «4d8-1». Возвращает null при неверном вводе.
export function rollDice(formula: string): DiceResult | null {
  const m = /^\s*(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i.exec(formula);
  if (!m) return null;
  const count = Math.min(100, Math.max(1, parseInt(m[1] || "1", 10)));
  const sides = Math.min(1000, Math.max(2, parseInt(m[2], 10)));
  const modifier = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return { formula: formula.trim(), rolls, modifier, total };
}
