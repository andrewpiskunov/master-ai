export interface DocumentTypeDef {
  key: string;
  label: string;
  icon: string;
  statuses: string[];
}

export const DOCUMENT_TYPES: DocumentTypeDef[] = [
  { key: "pc", label: "Персонаж игрока", icon: "shield", statuses: ["alive", "dead", "unknown"] },
  { key: "npc", label: "NPC", icon: "user", statuses: ["alive", "dead", "unknown"] },
  { key: "location", label: "Локация", icon: "map-pin", statuses: [] },
  { key: "faction", label: "Фракция", icon: "users", statuses: [] },
  { key: "secret", label: "Секрет", icon: "lock", statuses: ["hidden", "revealed"] },
  { key: "scene", label: "Сцена", icon: "clapperboard", statuses: ["planned", "used"] },
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
  alive: "Жив",
  dead: "Мёртв",
  unknown: "Неизвестно",
  hidden: "Скрыт",
  revealed: "Раскрыт",
  planned: "Запланировано",
  used: "Использовано",
  played: "Сыграно",
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}
