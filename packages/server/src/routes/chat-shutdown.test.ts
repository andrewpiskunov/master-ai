import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "../db/client.js";
import { buildApp } from "../app.js";
import { CliProvider } from "../llm/cli.js";
import { CampaignService } from "../services/campaigns.js";
import { ConversationService } from "../services/conversations.js";
import { DocumentService } from "../services/documents.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=";
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
async function waitUntil(check: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fake Codex");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// These tests exercise the real CLI process and its temporary image directory.
// A no-op close hook or a fire-and-forget abort must leave an observable leak.
describe("chat shutdown", () => {
  it.each(["assistant", "workshop"] as const)("app.close waits for %s child exit and image cleanup", async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "master-ai-test-shutdown-"));
    const recordPath = join(root, "child.json");
    const stoppedPath = join(root, "stopped.txt");
    const command = join(root, "codex");
    await writeFile(command, `#!${process.execPath}\nconst fs = require("node:fs");
const args = process.argv.slice(2);
const imagePath = args[args.indexOf("--image") + 1];
process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(stoppedPath)}, "terminated"); process.exit(0); });
process.stdin.resume();
setInterval(() => {}, 1000);
fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ pid: process.pid, imagePath, data: fs.readFileSync(imagePath).toString("base64") }));
`);
    await chmod(command, 0o700);
    const { db, sqlite } = createDb(":memory:");
    const campaign = new CampaignService(db).create({ name: "Карта" });
    const doc = new DocumentService(db).create({ campaignId: campaign.id, type: "session", title: "Сессия" });
    const conversations = new ConversationService(db);
    const app = buildApp({ db, llm: new CliProvider({ command, args: [] }) });
    let child: { pid: number; imagePath: string; data: string } | undefined;
    try {
      const uploaded = await app.inject({ method: "POST", url: `/api/campaigns/${campaign.id}/images`, payload: { name: "карта.png", dataUrl: png } });
      expect(uploaded.statusCode).toBe(201);
      const url = kind === "assistant" ? `/api/documents/${doc.id}/assistant` : `/api/campaigns/${campaign.id}/brainstorm/start`;
      const started = await app.inject({ method: "POST", url, payload: { message: "Опиши карту", imageIds: [uploaded.json().id] } });
      expect(started.statusCode).toBe(202);
      await waitUntil(async () => { try { child = JSON.parse(await readFile(recordPath, "utf8")); return true; } catch { return false; } });
      expect(child!.data).toBe(png.split(",")[1]);
      expect(isAlive(child!.pid)).toBe(true);
      await access(child!.imagePath);
      await app.close();
      expect(isAlive(child!.pid)).toBe(false);
      expect(await readFile(stoppedPath, "utf8")).toBe("terminated");
      await expect(access(child!.imagePath)).rejects.toMatchObject({ code: "ENOENT" });
      const conversation = kind === "assistant"
        ? conversations.getOrCreateForDocument(campaign.id, doc.id)
        : conversations.getOrCreateForCampaign(campaign.id);
      const messages = conversations.listMessages(conversation.id);
      expect(messages.map((message) => message.role)).toEqual(["user"]);
      expect(messages[0].meta?.images?.[0].id).toBe(uploaded.json().id);
    } finally {
      // RED runs must clean up their intentionally leaked real subprocess too.
      if (child && isAlive(child.pid)) process.kill(child.pid, "SIGKILL");
      if (child) await waitUntil(async () => { try { await access(child!.imagePath); return false; } catch { return true; } });
      await app.close();
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
