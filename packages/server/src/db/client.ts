import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export function createDb(path: string): {
  db: BetterSQLite3Database;
  sqlite: Database.Database;
} {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}
