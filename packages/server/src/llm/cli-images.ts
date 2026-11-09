import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageUploadSchema, type CompleteInput } from "@master-ai/shared";
import { LlmError } from "./provider.js";

export function renderPrompt(input: CompleteInput, imagePaths?: string[][]): string {
  const parts: string[] = [];
  if (input.system) parts.push(input.system);
  let index = 0;
  input.messages.forEach((message, messageIndex) => {
    const images = message.images?.map((image, i) =>
      `[Изображение ${++index}: ${image.name}${imagePaths ? ` — ${imagePaths[messageIndex][i]}` : ""}]`,
    ) ?? [];
    parts.push(`${message.role}: ${[message.content, ...images].filter(Boolean).join("\n")}`);
  });
  return parts.join("\n\n");
}

export async function prepareCliImages(input: CompleteInput, command: string, args: string[]): Promise<{
  args: string[]; prompt: string; cleanup: () => Promise<void>;
}> {
  if (!input.messages.some((message) => message.images?.length)) {
    return { args, prompt: renderPrompt(input), cleanup: async () => {} };
  }
  const executable = (command.split(/[\\/]/).pop() ?? "").replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  if (executable !== "codex" && executable !== "claude") {
    throw new LlmError("Этот CLI не поддерживает вложенные изображения. Выберите Codex, Claude Code или API с поддержкой изображений.");
  }
  const directory = await mkdtemp(join(tmpdir(), "master-ai-images-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    let index = 0;
    const paths: string[][] = [];
    for (const message of input.messages) {
      const messagePaths: string[] = [];
      for (const raw of message.images ?? []) {
        const image = ImageUploadSchema.parse(raw);
        const [header, base64] = image.dataUrl.split(",");
        const extension = header.includes("image/jpeg") ? "jpg" : header.includes("image/webp") ? "webp" : "png";
        const path = join(directory, `image-${++index}.${extension}`);
        await writeFile(path, Buffer.from(base64, "base64"), { mode: 0o600 });
        messagePaths.push(path);
      }
      paths.push(messagePaths);
    }
    const nextArgs = [...args];
    if (executable === "codex") {
      const stdin = nextArgs.lastIndexOf("-");
      nextArgs.splice(stdin < 0 ? nextArgs.length : stdin, 0, ...paths.flat().flatMap((path) => ["--image", path]));
    }
    return { args: nextArgs, prompt: renderPrompt(input, executable === "claude" ? paths : undefined), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
