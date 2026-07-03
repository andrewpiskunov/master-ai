// Игровой чат режима игры: метаданные сообщений и разбор ответа ИИ-мастера.

export interface GameLogEntry {
  title: string;
  important: boolean;
}

// Метаданные сообщения (messages.meta): у сообщения мастера — от чьего лица
// действие; у ответа ИИ на действие — запись лога событий.
export interface MessageMeta {
  actorId?: string;
  actorName?: string;
  actorKind?: "pc" | "npc" | "master";
  log?: GameLogEntry;
}

// Вырезает служебный блок ```log {"title":…,"important":…}``` из ответа ИИ.
// Незакрытый блок (стрим ещё идёт) — прячем хвост; битый JSON — блок убираем, log null.
// after — текст ПОСЛЕ log-блока: по контракту блок завершает ответ, но модель может
// дописать продолжение сцены; отдаём его отдельно, чтобы UI не красил его «скрытым».
export function extractLogBlock(text: string): { log: GameLogEntry | null; rest: string; after: string } {
  const fence = /```log\s*\n?([\s\S]*?)```/.exec(text);
  if (!fence) {
    const open = text.indexOf("```log");
    if (open >= 0) return { log: null, rest: text.slice(0, open), after: "" };
    return { log: null, rest: text, after: "" };
  }
  const rest = text.slice(0, fence.index).trim();
  const after = text.slice(fence.index + fence[0].length).trim();
  try {
    const parsed = JSON.parse(fence[1].trim()) as { title?: unknown; important?: unknown };
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return { log: { title: parsed.title.trim(), important: parsed.important === true }, rest, after };
    }
  } catch {
    // битый JSON — событие потеряно не будет: сервер подставит заголовок из действия
  }
  return { log: null, rest, after };
}

// Версия ответа для истории LLM: без служебного log-блока (текст до и после склеен).
// Модель не должна видеть в истории паттерн «текст после log-блока» — иначе имитирует его.
export function stripLogFence(text: string): string {
  const { rest, after } = extractLogBlock(text);
  return [rest, after].filter(Boolean).join("\n\n");
}

// Убирает из хвоста after абзацы, дословно повторяющие уже показанный текст rest
// (модель в длинном контексте склонна переписывать сцену заново после log-блока).
export function dedupeGameTail(after: string, rest: string): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const restNorm = norm(rest);
  return after
    .split(/\n{2,}/)
    .filter((p) => {
      const n = norm(p);
      return n && !restNorm.includes(n);
    })
    .join("\n\n")
    .trim();
}

// Заголовок записи лога, когда ИИ не вернул log-блок: первые слова действия.
export function fallbackLogTitle(action: string, max = 60): string {
  const s = action.trim().replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// Делит ответ ИИ-мастера на вступление и секции «Прочитай игрокам» / «Скрытое для
// мастера» (заголовки ## или ###; «скрытая информация…» тоже принимается).
export function parseGameSections(text: string): { intro: string; read: string | null; hidden: string | null } {
  const buf: Record<"intro" | "read" | "hidden", string[]> = { intro: [], read: [], hidden: [] };
  let cur: "intro" | "read" | "hidden" = "intro";
  for (const line of text.split("\n")) {
    const m = /^#{2,3}\s*(.+?)\s*$/.exec(line.trim());
    if (m) {
      const h = m[1].toLowerCase();
      if (h.includes("прочитай игрокам")) { cur = "read"; continue; }
      if (h.includes("скрыт")) { cur = "hidden"; continue; }
    }
    buf[cur].push(line);
  }
  const join = (a: string[]) => a.join("\n").trim();
  return {
    intro: join(buf.intro),
    read: buf.read.length ? join(buf.read) : null,
    hidden: buf.hidden.length ? join(buf.hidden) : null,
  };
}
