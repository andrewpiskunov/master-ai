import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexImageGenerator, loadImageGenerator } from "./image-generation.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=";
const input = { document: { title: "Глеб", type: "npc", text: "Старый смотритель маяка." }, prompt: "Портрет в акварели" };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixture(body: string, args: string[] = []) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "master-ai-image-test-")));
  dirs.push(root);
  const command = join(root, "codex");
  const record = join(root, "request.json");
  await writeFile(command, `#!${process.execPath}\nconst fs=require('node:fs');const path=require('node:path');let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),prompt}));${body}});\n`);
  await chmod(command, 0o700);
  return { root, record, config: { command, args }, generator: new CodexImageGenerator({ command, args }, { tempRoot: root, timeoutMs: 2_000 }) };
}

describe("Codex image generation", () => {
  it("uses a separate writable workspace, preserves model configuration and returns a real file", async () => {
    const args = ["exec", "--model", "gpt-6.1-sol", "--config", 'model_reasoning_effort="medium"', "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-"];
    const f = await fixture(`fs.writeFileSync(path.join(process.cwd(),'generated.png'),Buffer.from('${PNG}','base64'));process.stdout.write('done');`, args);
    const image = await f.generator.generate(input);
    expect(image).toEqual({ name: "illustration.png", dataUrl: `data:image/png;base64,${PNG}` });
    const request = JSON.parse(await readFile(f.record, "utf8"));
    expect(request.cwd).not.toBe(f.root);
    expect(request.cwd.startsWith(join(f.root, "master-ai-image-"))).toBe(true);
    expect(request.args).toContain("workspace-write");
    expect(request.args).not.toContain("read-only");
    expect(request.args).toContain("gpt-6.1-sol");
    expect(request.args).toContain('model_reasoning_effort="medium"');
    expect(request.args.filter((arg: string) => arg === "--skip-git-repo-check")).toHaveLength(1);
    expect(request.prompt).toContain("$imagegen");
    expect(request.prompt).toContain("Глеб");
    expect(request.prompt).toContain("npc");
    expect(request.prompt).toContain("Старый смотритель маяка.");
    expect(request.prompt).toContain("Портрет в акварели");
    expect(args).toContain("read-only");
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it.each([
    ["missing file", "process.stdout.write('Successfully generated an image');"],
    ["non-image file", "fs.writeFileSync('generated.png','not an image');"],
  ])("does not accept success text or invalid output: %s", async (_name, body) => {
    const f = await fixture(body);
    await expect(f.generator.generate(input)).rejects.toThrow(/изображени/i);
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it("rejects an output symlink instead of reading outside its workspace", async () => {
    const f = await fixture(`fs.symlinkSync(${JSON.stringify(process.execPath)},'generated.png');`);
    await expect(f.generator.generate(input)).rejects.toThrow(/изображени/i);
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it("reports usage limits without leaking CLI transcripts and cleans up", async () => {
    const f = await fixture("process.stderr.write('PRIVATE PROMPT internal reasoning usage limit reached');process.exit(1);");
    await expect(f.generator.generate(input)).rejects.toThrow(/лимит/i);
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it("times out a hung subprocess and removes its workspace", async () => {
    const f = await fixture("setInterval(()=>{},1000);");
    const generator = new CodexImageGenerator(f.config, { tempRoot: f.root, timeoutMs: 2_000 });
    await expect(generator.generate(input)).rejects.toThrow(/время/i);
    expect(JSON.parse(await readFile(f.record, "utf8")).prompt).toContain("$imagegen");
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it("aborts the subprocess before accepting its file and removes its workspace", async () => {
    const f = await fixture(`fs.writeFileSync('generated.png',Buffer.from('${PNG}','base64'));setInterval(()=>{},1000);`);
    const abort = new AbortController();
    const result = f.generator.generate(input, { signal: abort.signal });
    await expect.poll(() => readFile(f.record, "utf8").then(() => true, () => false)).toBe(true);
    abort.abort();
    await expect(result).rejects.toThrow(/останов/i);
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it("cleans up when the configured Codex executable cannot start", async () => {
    const root = await mkdtemp(join(tmpdir(), "master-ai-image-test-"));
    dirs.push(root);
    const generator = new CodexImageGenerator({ command: join(root, "missing", "codex"), args: [] }, { tempRoot: root });
    await expect(generator.generate(input)).rejects.toThrow(/запустить/i);
    expect(await readdir(root)).toEqual([]);
  });

  it("rejects a different configured CLI explicitly", async () => {
    const generator = loadImageGenerator({ MASTER_AI_LLM_CMD: "claude", MASTER_AI_LLM_ARGS: "-p" });
    await expect(generator.generate(input)).rejects.toThrow(/Codex/);
  });
});
