// Поиск упоминаний сущностей кампании в произвольном тексте — общий для
// редактора (ProseMirror-декорации) и чатов (markdown-рендер).
// href задаётся там, где упоминание должно быть кликабельной ссылкой (чаты).
// hrefs появляется у неоднозначных названий (несколько документов с одним именем).
export interface MentionItem { title: string; type: string; href?: string; hrefs?: string[] }
export interface MentionSpan { start: number; end: number; type: string; href?: string; hrefs?: string[] }

const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

// Готовит список к поиску: отбрасывает слишком короткие названия, сливает
// одноимённые документы в одну запись (все их href — в hrefs) и ставит
// длинные названия вперёд, чтобы они имели приоритет при пересечениях.
export function prepareMentions(mentions: MentionItem[]): MentionItem[] {
  const byTitle = new Map<string, MentionItem>();
  for (const m of mentions) {
    if (m.title.trim().length < 3) continue;
    const key = m.title.trim().toLowerCase();
    const seen = byTitle.get(key);
    if (!seen) {
      byTitle.set(key, { ...m });
    } else if (m.href && seen.href !== m.href) {
      seen.hrefs = [...(seen.hrefs ?? (seen.href ? [seen.href] : [])), m.href];
    }
  }
  return [...byTitle.values()].sort((a, b) => b.title.length - a.title.length);
}

// Находит непересекающиеся вхождения названий (по границам слов) в одной строке.
export function matchMentions(text: string, prepared: MentionItem[]): MentionSpan[] {
  if (!prepared.length) return [];
  const lower = text.toLowerCase();
  const taken = new Array(text.length).fill(false);
  const spans: MentionSpan[] = [];
  for (const m of prepared) {
    const needle = m.title.toLowerCase();
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      const end = idx + needle.length;
      const before = idx === 0 ? " " : text[idx - 1];
      const after = end >= text.length ? " " : text[end];
      let free = true;
      for (let i = idx; i < end; i++) if (taken[i]) { free = false; break; }
      if (free && !isWordChar(before) && !isWordChar(after)) {
        spans.push({ start: idx, end, type: m.type, href: m.href, hrefs: m.hrefs });
        for (let i = idx; i < end; i++) taken[i] = true;
      }
      idx = lower.indexOf(needle, end);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
