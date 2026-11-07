import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["README.md", "README.en.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "CHANGELOG.md"];
for (const directory of ["docs", "examples", "packages/server", "packages/web", "packages/shared"]) {
  // Historical plans may refer to old paths. Validate maintained public guides.
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(`${directory}/${entry.name}`);
  }
}

const failures = [];
let links = 0;
for (const file of files) {
  const content = await readFile(resolve(root, file), "utf8");
  const prose = content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  const targets = [
    ...Array.from(prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g), (match) => match[1]),
    ...Array.from(prose.matchAll(/<(?:img|a)\b[^>]*\b(?:src|href)="([^"]+)"/g), (match) => match[1]),
  ];
  for (let target of targets) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) || target.startsWith("#")) continue;
    target = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!target) continue;
    links++;
    const destination = resolve(target.startsWith("/") ? root : dirname(resolve(root, file)), target.replace(/^\//, ""));
    if (relative(root, destination).startsWith("..")) {
      failures.push(`${file}: link escapes repository: ${target}`);
      continue;
    }
    try {
      await stat(destination);
    } catch {
      failures.push(`${file}: missing target ${target}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation verified: ${files.length} Markdown files, ${links} local links and images.`);
}
