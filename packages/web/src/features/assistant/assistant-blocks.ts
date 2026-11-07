import { DOCUMENT_TYPES, getDocumentType } from "@master-ai/shared";

export interface NewEntity { type: string; title: string; text: string }
export interface EditEntity { title: string; rename?: string; text?: string }

// Стабильный ключ блока ```doc``` — чтобы персистентно помнить, что его уже применяли.
// Сравнение по тексту документа ненадёжно: markdown→doc→text расходится с сохранённым
// контентом на сложном форматировании (списки, жирный, кавычки), и карточка «оживает».
export function blockKey(block: string): string {
  const s = block.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${s.length}`;
}

const dequote = (s: string) => s.trim().replace(/^[«"']|[»"']$/g, "");

// Разбирает блоки ```edit-doc … ``` — изменение существующих документов (переименование/правка).
function parseEdits(content: string): { edits: EditEntity[]; rest: string } {
  const edits: EditEntity[] = [];
  let rest = content;
  const re = /```edit-doc\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const block = m[1];
    const titleM = /^\s*title:\s*(.+)$/im.exec(block);
    if (!titleM) continue;
    const renameM = /^\s*rename:\s*(.+)$/im.exec(block);
    const sep = block.indexOf("---");
    const text = sep >= 0 ? block.slice(sep + 3).trim() : "";
    edits.push({ title: dequote(titleM[1]), rename: renameM ? dequote(renameM[1]) : undefined, text: text || undefined });
    rest = rest.replace(m[0], "");
  }
  return { edits, rest };
}

// Разбирает блок ```new-doc … ``` с предложением создать новую сущность.
function parseNewDoc(block: string): NewEntity | null {
  const typeM = /^\s*type:\s*([^\s]+)/im.exec(block);
  const titleM = /^\s*title:\s*(.+)$/im.exec(block);
  if (!typeM || !titleM) return null;
  const sep = block.indexOf("---");
  const text = sep >= 0
    ? block.slice(sep + 3).trim()
    : block.replace(/^\s*type:.*$/im, "").replace(/^\s*title:.*$/im, "").trim();
  return { type: typeM[1].trim(), title: titleM[1].trim().replace(/^[«"']|[»"']$/g, ""), text };
}

// Выделяет из ответа ИИ: правки существующих документов (```edit-doc), правку
// текущего документа (```doc), предложение новой сущности (```new-doc) и вводный текст.
export function parseAssistant(content: string): { intro: string; doc: string | null; newDocs: NewEntity[]; edits: EditEntity[] } {
  const { edits, rest } = parseEdits(content);
  // незакрытый блок edit-doc во время стрима — прячем хвост
  let work = rest;
  const openEdit = work.indexOf("```edit-doc");
  if (openEdit >= 0) work = work.slice(0, openEdit);

  // Все закрытые блоки new-doc (ассистент может предложить несколько связанных сущностей).
  const newDocs: NewEntity[] = [];
  const re = /```new-doc\s*\n([\s\S]*?)```/g;
  let nm: RegExpExecArray | null;
  while ((nm = re.exec(work)) !== null) {
    const nd = parseNewDoc(nm[1]);
    if (nd) newDocs.push(nd);
  }
  if (newDocs.length) {
    return { intro: work.replace(/```new-doc\s*\n[\s\S]*?```/g, "").trim(), doc: null, newDocs, edits };
  }
  if (work.includes("```new-doc")) {
    return { intro: work.slice(0, work.indexOf("```new-doc")).trim(), doc: null, newDocs: [], edits };
  }
  const closed = /```doc\s*\n([\s\S]*?)```/.exec(work);
  if (closed) return { intro: work.replace(closed[0], "").trim(), doc: closed[1].trim(), newDocs: [], edits };
  const open = work.indexOf("```doc");
  if (open >= 0) return { intro: work.slice(0, open).trim(), doc: null, newDocs: [], edits };
  return { intro: work.trim(), doc: null, newDocs: [], edits };
}

const TYPE_LIST = DOCUMENT_TYPES.map((t) => `${t.key} (${t.label})`).join(", ");

// Общая часть системного промпта про блоки new-doc/edit-doc — используется
// помощником документа и игровым чатом режима игры.
export function entityBlocksPrompt(documents: { title: string; type: string }[]): string {
  return (
    `Когда пользователь просит СОЗДАТЬ новую сущность (например «сделай из этой заметки персонажа», ` +
    `«создай NPC», «добавь локацию») — НЕ переписывай текущий документ. Вместо этого предложи новую сущность ` +
    `блоком \`\`\`new-doc и \`\`\` строго в формате:\n` +
    `type: <ключ типа из списка>\ntitle: <короткое название, 1–3 слова, без кавычек>\n---\n<описание сущности обычным текстом>\n` +
    `Доступные типы: ${TYPE_LIST}. Для персонажа игрока используй pc, для прочих персонажей — npc. ` +
    `Для npc и pc давай полное имя — имя и фамилию (или родовое прозвище), а не одно голое имя: «Гаст Двукоготь», а не «Гаст». ` +
    `Вне блока коротко поясни, что предлагаешь создать.\n\n` +
    `Когда пользователь просит ИЗМЕНИТЬ, ПЕРЕИМЕНОВАТЬ или ОБНОВИТЬ уже существующие документы ` +
    `(например «добавь всем NPC фамилии», «переименуй X», «обнови описание Y») — НЕ создавай новые. ` +
    `Для КАЖДОГО изменяемого документа верни отдельный блок \`\`\`edit-doc и \`\`\` строго в формате:\n` +
    `title: <точное название существующего документа из списка ниже>\nrename: <новое название> (только если меняешь имя)\n---\n<полный новый текст документа> (только если меняешь содержимое; иначе оставь пустым)\n` +
    `Можно вернуть несколько блоков edit-doc подряд. Существующие документы кампании: ` +
    `${documents.slice(0, 100).map((d) => `«${d.title}» (${getDocumentType(d.type)?.label ?? d.type})`).join(", ") || "(пока нет)"}.\n\n` +
    `Если правка не нужна — отвечай обычным текстом без блоков.`
  );
}
