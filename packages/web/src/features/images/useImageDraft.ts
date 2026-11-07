import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { MAX_IMAGE_BYTES, MAX_MESSAGE_IMAGES, type ImageAttachment } from "@master-ai/shared";
import { api } from "../../api/client.js";

interface DraftImage {
  key: string;
  name: string;
  mimeType: ImageAttachment["mimeType"];
  dataUrl: string | null;
  uploaded?: ImageAttachment;
}
interface DraftState { items: DraftImage[]; error: string }
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const imageError = (error: unknown) => error instanceof Error ? error.message : "Не удалось загрузить изображение";

// Резервируем место синхронно: параллельные вставки не обходят лимит и сохраняют порядок.
// Каждый контекст имеет отдельный объект; запоздавший FileReader не меняет новую сущность.
export function useImageDraft(contextKey: string) {
  const [state, setState] = useState<DraftState>({ items: [], error: "" });
  const scopeRef = useRef({ key: contextKey, state, alive: true });
  if (scopeRef.current.key !== contextKey) {
    scopeRef.current.alive = false;
    scopeRef.current = { key: contextKey, state: { items: [], error: "" }, alive: true };
  }
  const scope = scopeRef.current;
  useEffect(() => {
    scope.alive = true;
    return () => { scope.alive = false; };
  }, [scope]);
  function update(next: DraftState) {
    if (!scope.alive || scopeRef.current !== scope) return;
    scope.state = next;
    setState(next);
  }
  function addFiles(files: Iterable<File>) {
    if (!scope.alive || scopeRef.current !== scope) return;
    let next = [...scope.state.items];
    const errors: string[] = [];
    const toRead: { file: File; item: DraftImage }[] = [];
    for (const file of files) {
      if (!MIME_TYPES.has(file.type)) { errors.push(`${file.name}: доступны PNG, JPEG и WebP.`); continue; }
      if (file.size > MAX_IMAGE_BYTES) { errors.push(`${file.name}: максимум 10 МБ на изображение.`); continue; }
      if (next.length >= MAX_MESSAGE_IMAGES) { errors.push(`Не больше ${MAX_MESSAGE_IMAGES} изображений за раз.`); break; }
      const item: DraftImage = { key: crypto.randomUUID(), name: file.name || "Изображение", mimeType: file.type as ImageAttachment["mimeType"], dataUrl: null };
      next.push(item);
      toRead.push({ file, item });
    }
    update({ items: next, error: errors.join(" ") });
    for (const { file, item } of toRead) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        update({ ...scope.state, items: scope.state.items.map((i) => i.key === item.key ? { ...i, dataUrl: reader.result as string } : i) });
      };
      reader.onerror = () => update({ items: scope.state.items.filter((i) => i.key !== item.key), error: `Не удалось прочитать ${item.name}.` });
      reader.onabort = reader.onerror;
      reader.readAsDataURL(file);
    }
  }
  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const data = event.clipboardData;
    const items = Array.from(data.items ?? []).filter((i) => i.kind === "file" && i.type.startsWith("image/"));
    const files = items.length
      ? items.map((i) => i.getAsFile()).filter((f): f is File => f !== null)
      : Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!items.length && !files.length) return;
    event.preventDefault();
    addFiles(files);
  }
  async function upload(campaignId: string): Promise<ImageAttachment[]> {
    const snapshot = [...scope.state.items];
    if (snapshot.some((i) => !i.dataUrl)) throw new Error("Изображение ещё читается. Подождите немного.");
    const images: ImageAttachment[] = [];
    for (const item of snapshot) {
      if (!scope.alive || scopeRef.current !== scope) throw new Error("Документ изменился");
      const uploaded = item.uploaded ?? await api.uploadImage(campaignId, { name: item.name, dataUrl: item.dataUrl! });
      if (!scope.alive || scopeRef.current !== scope) throw new Error("Документ изменился");
      update({ ...scope.state, items: scope.state.items.map((i) => i.key === item.key ? { ...i, uploaded } : i) });
      images.push(uploaded);
    }
    return images;
  }
  return {
    items: scope.state.items,
    error: scope.state.error,
    reading: scope.state.items.some((i) => i.dataUrl === null),
    addFiles, onPaste, upload,
    remove: (key: string) => update({ ...scope.state, items: scope.state.items.filter((i) => i.key !== key) }),
    clear: () => update({ items: [], error: "" }),
    isCurrent: () => scope.alive && scopeRef.current === scope,
  };
}
export type ImageDraft = ReturnType<typeof useImageDraft>;
