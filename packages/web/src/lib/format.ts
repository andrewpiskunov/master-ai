// Относительное время: «только что», «N мин назад», …; старше недели — дата.
export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return "только что";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU");
}

// Форматирование расхода нейросети: токены с разделителями, длительность в секундах.
export const fmtTokens = (n: number): string => n.toLocaleString("ru-RU");
export const fmtDuration = (ms: number): string => (ms > 0 ? `${(ms / 1000).toFixed(1)} с` : "—");

// Русское склонение существительного по числу: [1, 2-4, 5-0/11-14].
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
