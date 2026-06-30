export interface DocumentTypeDef {
  key: string;
  label: string;
  icon: string;
  statuses: string[];
}

export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  { key: "pc", label: "Персонаж игрока", icon: "shield", statuses: ["active", "retired", "deceased"] },
  { key: "npc", label: "NPC", icon: "user", statuses: ["active", "retired", "deceased"] },
  { key: "location", label: "Локация", icon: "map-pin", statuses: [] },
  { key: "faction", label: "Фракция", icon: "users", statuses: [] },
  { key: "secret", label: "Секрет", icon: "lock", statuses: ["hidden", "revealed"] },
  { key: "scene", label: "Сцена", icon: "clapperboard", statuses: ["planned", "used"] },
  { key: "encounter", label: "Столкновение", icon: "swords", statuses: ["planned", "used"] },
  { key: "arc", label: "Сюжетная арка", icon: "milestone", statuses: ["planned", "active", "completed"] },
  { key: "session", label: "Сессия", icon: "calendar", statuses: ["planned", "played"] },
  { key: "item", label: "Предмет", icon: "package", statuses: [] },
  { key: "lore", label: "Лор", icon: "book", statuses: [] },
  { key: "reference", label: "Референс", icon: "library", statuses: [] },
  { key: "note", label: "Заметка", icon: "file", statuses: [] },
];

export function getDocumentType(key: string): DocumentTypeDef | undefined {
  return DOCUMENT_TYPES.find((t) => t.key === key);
}

// Русские подписи статусов (значение в БД остаётся англоязычным ключом).
export const STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  retired: "Отошёл от дел",
  deceased: "Погиб",
  hidden: "Скрыт",
  revealed: "Раскрыт",
  planned: "Запланировано",
  used: "Использовано",
  played: "Сыграно",
  completed: "Завершена",
  // Прежние статусы персонажей — на случай ещё не мигрированных данных.
  alive: "Активен",
  dead: "Погиб",
  unknown: "Активен",
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

// Отношение персонажа к партии (как «Disposition» в Campaign Arks) — хранится
// в fields.disposition. Применимо к npc и pc.
export interface DispositionDef {
  key: string;
  label: string;
  color: string;
}

export const DISPOSITIONS: DispositionDef[] = [
  { key: "villain", label: "Злодей", color: "#f87171" },
  { key: "rival", label: "Соперник", color: "#fbbf24" },
  { key: "neutral", label: "Нейтрал", color: "#94a3b8" },
  { key: "friendly", label: "Друг", color: "#4ade80" },
  { key: "ally", label: "Союзник", color: "#38bdf8" },
];

export function getDisposition(key: string): DispositionDef | undefined {
  return DISPOSITIONS.find((d) => d.key === key);
}

// Типы, у которых есть отношение к партии.
export function hasDisposition(type: string): boolean {
  return type === "npc" || type === "pc";
}
