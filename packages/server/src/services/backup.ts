import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

const KEEP = 7;
const NAME_RE = /^master-ai-\d{4}-\d{2}-\d{2}\.sqlite$/;

// Дневная резервная копия базы с ротацией: один файл в день, храним последние KEEP.
// Вызывается при старте сервера; better-sqlite3 backup корректно работает с WAL.
export async function backupDaily(sqlite: Database.Database, dir: string, today = new Date()): Promise<string | null> {
  mkdirSync(dir, { recursive: true });
  const stamp = today.toISOString().slice(0, 10);
  const file = join(dir, `master-ai-${stamp}.sqlite`);
  if (existsSync(file)) return null; // сегодняшняя копия уже есть
  await sqlite.backup(file);
  const all = readdirSync(dir).filter((f) => NAME_RE.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP))) unlinkSync(join(dir, f));
  return file;
}
