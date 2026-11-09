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

  it("edits the supplied image using private reference files inside the job workspace", async () => {
    const f = await fixture(`const args=process.argv.slice(2);const refs=args.flatMap((arg,i)=>arg==='--image'?[args[i+1]]:[]).map(file=>({path:file,bytes:fs.readFileSync(file).toString('base64'),mode:fs.statSync(file).mode&0o777}));fs.writeFileSync(path.join(path.dirname(process.cwd()),'references.json'),JSON.stringify(refs));fs.writeFileSync('generated.png',Buffer.from('${PNG}','base64'));`, ["exec", "--sandbox", "read-only"]);
    const image = await f.generator.generate({ ...input, prompt: "Remove only the title", images: [{ name: "generated.png", dataUrl: `data:image/png;base64,${PNG}` }] });
    expect(image.dataUrl).toBe(`data:image/png;base64,${PNG}`);
    const request = JSON.parse(await readFile(f.record, "utf8"));
    const references = JSON.parse(await readFile(join(f.root, "references.json"), "utf8"));
    expect(references).toEqual([{ path: join(request.cwd, "reference-1.png"), bytes: PNG, mode: 0o600 }]);
    expect(request.args).toContain("workspace-write");
    expect(request.args).not.toContain("read-only");
    expect(request.prompt).toMatch(/edit the attached image/i);
    expect(request.prompt).toMatch(/preserve/i);
    expect(request.prompt).toContain("Remove only the title");
    expect(request.prompt).not.toContain("data:image");
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it.each([
    [{ name: "bad.png", dataUrl: "data:image/png;base64,bm90IGFuIGltYWdl" }],
    Array.from({ length: 5 }, () => ({ name: "portrait.png", dataUrl: `data:image/png;base64,${PNG}` })),
  ])("rejects malformed or excessive reference images before starting Codex: %j", async (...images) => {
    const f = await fixture(`fs.writeFileSync('generated.png',Buffer.from('${PNG}','base64'));`);
    await expect(f.generator.generate({ ...input, images })).rejects.toThrow(/изображени/i);
    await expect(readFile(f.record, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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

  it.each([
    ["tool unavailable", "The built-in image_gen tool is unavailable in this session.", 0, /встроенная генерация изображений недоступна/i],
    ["usage limit", "Image generation usage limit reached. Please try again later.", 0, /лимит/i],
    ["authentication", "Codex authentication failed. Please log in.", 1, /не авторизован/i],
    ["missing source image", "Please attach the source image before I can remove the title.", 0, /исходное изображение/i],
  ])("reports a safe %s diagnosis from the final message instead of a missing-file error", async (_label, status, code, expected) => {
    const f = await fixture(`const args=process.argv.slice(2);const output=args[args.indexOf('--output-last-message')+1];if(output)fs.writeFileSync(output,'PRIVATE PROMPT AND REASONING '+${JSON.stringify(status)});process.stdout.write('PRIVATE TRANSCRIPT');process.exit(${code});`);
    let message = "";
    try { await f.generator.generate(input); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(expected);
    expect(message).not.toMatch(/PRIVATE|TRANSCRIPT|REASONING|generated\.png/);
    expect((await readdir(f.root)).filter((name) => name.startsWith("master-ai-image-"))).toEqual([]);
  });

  it("overrides an existing final-message destination without writing outside its workspace", async () => {
    const f = await fixture("process.stdout.write('No artifact');", ["exec", "--output-last-message", "/unrelated/status.txt", "-o=/unrelated/other.txt"]);
    await expect(f.generator.generate(input)).rejects.toThrow(/изображени/i);
    const request = JSON.parse(await readFile(f.record, "utf8"));
    expect(request.args.filter((arg: string) => arg === "--output-last-message")).toHaveLength(1);
    const output = request.args[request.args.indexOf("--output-last-message") + 1];
    expect(output).toBe(join(request.cwd, "final-message.txt"));
    expect(request.args.join(" ")).not.toContain("/unrelated/");
  });

  it("diagnoses the final status instead of keywords from a prompt echoed to stderr", async () => {
    const f = await fixture("const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],'The image_gen tool is unavailable.');process.stderr.write(prompt);");
    await expect(f.generator.generate(input)).rejects.toThrow(/встроенная генерация изображений недоступна/i);
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
    const result = f.generator.generate({ ...input, images: [{ name: "portrait.png", dataUrl: `data:image/png;base64,${PNG}` }] }, { signal: abort.signal });
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
