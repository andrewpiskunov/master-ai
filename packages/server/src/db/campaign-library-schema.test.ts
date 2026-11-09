import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb } from "./client.js";
import { CampaignService } from "../services/campaigns.js";

describe("campaign library migration", () => {
  it("upgrades an existing database and initializes activity from creation without changing its campaign", () => {
    const root = mkdtempSync(join(tmpdir(), "master-ai-library-"));
    const source = fileURLToPath(new URL("../../drizzle/", import.meta.url));
    const legacyMigrations = join(root, "legacy-migrations");
    mkdirSync(join(legacyMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 12);
    for (const entry of journal.entries) copyFileSync(join(source, `${entry.tag}.sql`), join(legacyMigrations, `${entry.tag}.sql`));
    writeFileSync(join(legacyMigrations, "meta/_journal.json"), JSON.stringify(journal));
    const path = join(root, "campaigns.sqlite");
    let sqlite: Database.Database | undefined;
    try {
      sqlite = new Database(path);
      migrate(drizzle(sqlite), { migrationsFolder: legacyMigrations });
      sqlite.prepare("INSERT INTO campaigns (id, name, system, description, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("existing", "Старая кампания", "Fate", "Сохранённое описание", "2022-06-01T12:00:00.000Z");
      sqlite.close(); sqlite = undefined;
      const upgraded = createDb(path); sqlite = upgraded.sqlite;
      expect(new CampaignService(upgraded.db).get("existing")).toMatchObject({
        id: "existing", name: "Старая кампания", system: "Fate", description: "Сохранённое описание",
        createdAt: "2022-06-01T12:00:00.000Z", updatedAt: "2022-06-01T12:00:00.000Z", cover: null,
      });
    } finally { sqlite?.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
