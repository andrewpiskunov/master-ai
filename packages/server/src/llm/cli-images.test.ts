import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, chmod, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CliProvider } from "./cli.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlS8AAAAASUVORK5CYII=";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fakeCli(name: string, script: string) {
  const root = await mkdtemp(join(tmpdir(), "master-ai-test-cli-"));
  roots.push(root);
  const command = join(root, name);
  await writeFile(command, `#!${process.execPath}\n${script}`);
  await chmod(command, 0o700);
  return { root, command };
}
async function collect(iter: AsyncIterable<string>) { let out = ""; for await (const chunk of iter) out += chunk; return out; }
const input = { messages: [{ role: "user" as const, content: "Опиши карту", images: [{ name: "map.png", dataUrl: png }] }] };

describe("CLI image inputs", () => {
  it("passes real image files to Codex and removes them after completion", async () => {
    const { command } = await fakeCli("codex", `const fs=require('node:fs');const args=process.argv.slice(2);const path=args[args.indexOf('--image')+1];let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({path,bytes:fs.readFileSync(path).toString('base64'),prompt})));`);
    const response = JSON.parse(await collect(new CliProvider({ command, args: ["-"] }).complete(input)));
    expect(response.bytes).toBe(png.split(",")[1]);
    expect(response.prompt).toContain("map.png");
    expect(response.prompt).toContain("Опиши карту");
    await expect(access(response.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans image files after CLI failure", async () => {
    const { root, command } = await fakeCli("codex", `const fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(process.env.MASTER_AI_TEST_IMAGE_RECORD,args[args.indexOf('--image')+1]);process.exit(3);`);
    const record = join(root, "record.txt");
    const prior = process.env.MASTER_AI_TEST_IMAGE_RECORD;
    process.env.MASTER_AI_TEST_IMAGE_RECORD = record;
    try {
      await expect(collect(new CliProvider({ command, args: [] }).complete(input))).rejects.toThrow("кодом 3");
      await expect(access(await readFile(record, "utf8"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (prior === undefined) delete process.env.MASTER_AI_TEST_IMAGE_RECORD; else process.env.MASTER_AI_TEST_IMAGE_RECORD = prior;
    }
  });

  it("gives Claude readable image paths rather than discarding images", async () => {
    const { command } = await fakeCli("claude", `let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>process.stdout.write(prompt));`);
    const out = await collect(new CliProvider({ command, args: ["-p"] }).complete(input));
    expect(out).toContain("map.png");
    expect(out).toMatch(/master-ai-images-.*\/image-1\.png/);
    expect(out).not.toContain("base64");
  });

  it("reports unsupported CLI instead of silently losing the image", async () => {
    await expect(collect(new CliProvider({ command: process.execPath, args: ["-e", "process.stdout.write('ignored')"] }).complete(input))).rejects.toThrow(/изображени/i);
  });
});

it("cleans uploaded files when the image request is stopped", async () => {
  const { command } = await fakeCli("codex", `const args=process.argv.slice(2);process.stdout.write(JSON.stringify({path:args[args.indexOf('--image')+1]}));setTimeout(()=>{},60000);`);
  const abort = new AbortController();
  let path = "";
  for await (const chunk of new CliProvider({ command, args: [] }).complete(input, { signal: abort.signal })) {
    path = JSON.parse(chunk).path;
    abort.abort();
  }
  expect(path).toContain("master-ai-images-");
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});
