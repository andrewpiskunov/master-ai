import { describe, expect, it } from "vitest";
import { ImageGenerationJobService } from "./image-generation-jobs.js";

const image = { name: "portrait.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
const attachment = { id: "225dc92d-c852-4392-aa0e-869d13b57149", name: "portrait.png", mimeType: "image/png" as const };

async function done(jobs: ImageGenerationJobService, id: string) {
  await expect.poll(() => jobs.status(id).running).toBe(false);
}

describe("image generation background jobs", () => {
  it("keeps independent document status and rejects duplicate starts until persistence completes", async () => {
    const jobs = new ImageGenerationJobService();
    let resolve!: (value: typeof image) => void;
    const result = new Promise<typeof image>((r) => { resolve = r; });
    expect(jobs.start("doc", () => result, () => attachment)).toBe(true);
    expect(jobs.status("doc").running).toBe(true);
    expect(jobs.status("other")).toEqual({ running: false, error: null });
    expect(jobs.start("doc", async () => image, () => attachment)).toBe(false);
    resolve(image);
    await done(jobs, "doc");
    expect(jobs.status("doc")).toEqual({ running: false, error: null, image: attachment });
  });

  it("does not persist a result after stopping even when a generator ignores abort", async () => {
    const jobs = new ImageGenerationJobService();
    let resolve!: (value: typeof image) => void;
    let stored = false;
    let signal!: AbortSignal;
    const result = new Promise<typeof image>((r) => { resolve = r; });
    jobs.start("doc", (s) => { signal = s; return result; }, () => { stored = true; return attachment; });
    expect(jobs.stop("doc")).toBe(true);
    expect(signal.aborted).toBe(true);
    resolve(image);
    await done(jobs, "doc");
    expect(stored).toBe(false);
    expect(jobs.status("doc")).toEqual({ running: false, error: null });
    expect(jobs.stop("doc")).toBe(false);
  });

  it("turns generator and persistence failures into a readable status and permits retry", async () => {
    const jobs = new ImageGenerationJobService();
    jobs.start("doc", async () => { throw new Error("Лимит Codex"); }, () => attachment);
    await done(jobs, "doc");
    expect(jobs.status("doc").error).toBe("Лимит Codex");
    expect(jobs.start("doc", async () => image, () => { throw new Error("Не удалось сохранить"); })).toBe(true);
    await done(jobs, "doc");
    expect(jobs.status("doc")).toEqual({ running: false, error: "Не удалось сохранить" });
  });

  it("does not report a saved image when its entity was deleted", async () => {
    const jobs = new ImageGenerationJobService();
    jobs.start("doc", async () => image, () => undefined);
    await done(jobs, "doc");
    expect(jobs.status("doc").image).toBeUndefined();
  });
});
