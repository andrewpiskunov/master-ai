import { mkdtempSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createDb } from "../db/client.js";
import { DocumentService } from "./documents.js";
import { backupDaily } from "./backup.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "master-ai-backup-"));
  const { db, sqlite } = createDb(":memory:");
  new DocumentService(db).create({ campaignId: "c1", type: "npc", title: "Барон" });
  return { dir, sqlite };
}

describe("backupDaily", () => {
  it("создаёт дневную копию — валидный файл SQLite", async () => {
    const { dir, sqlite } = setup();
    const file = await backupDaily(sqlite, dir, new Date("2026-07-02T10:00:00Z"));
    expect(file).toMatch(/master-ai-2026-07-02\.sqlite$/);
    const head = readFileSync(file!).subarray(0, 15).toString();
    expect(head).toBe("SQLite format 3");
  });

  it("не делает вторую копию в тот же день", async () => {
    const { dir, sqlite } = setup();
    await backupDaily(sqlite, dir, new Date("2026-07-02T10:00:00Z"));
    const again = await backupDaily(sqlite, dir, new Date("2026-07-02T18:00:00Z"));
    expect(again).toBeNull();
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it("ротация: хранит только последние 7 копий", async () => {
    const { dir, sqlite } = setup();
    for (let d = 1; d <= 9; d++) {
      writeFileSync(join(dir, `master-ai-2026-06-${String(d).padStart(2, "0")}.sqlite`), "x");
    }
    await backupDaily(sqlite, dir, new Date("2026-07-02T10:00:00Z"));
    const left = readdirSync(dir).sort();
    expect(left).toHaveLength(7);
    expect(left[0]).toBe("master-ai-2026-06-04.sqlite"); // три самых старых удалены
    expect(left[6]).toBe("master-ai-2026-07-02.sqlite");
  });
});
