import { pmText } from "../../lib/prosemirror-text.js";

// Кеш извлечённого текста документов: pmText обходит всё дерево ProseMirror,
// а карта связей и «связанные документы» зовут его для всех документов кампании
// при каждом рендере. Ключ — updatedAt: правка документа сбрасывает запись.
const cache = new Map<string, { stamp: string; text: string }>();

export function docText(d: { id: string; updatedAt: string; contentJson?: unknown }): string {
  const hit = cache.get(d.id);
  if (hit && hit.stamp === d.updatedAt) return hit.text;
  const text = pmText(d.contentJson);
  cache.set(d.id, { stamp: d.updatedAt, text });
  return text;
}
