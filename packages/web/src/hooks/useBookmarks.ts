import { useEffect, useState } from "react";

// Закладки документов для быстрого доступа из левого меню. Один пользователь —
// храним локально (localStorage) и синхронизируем вкладки через событие.
export interface Bookmark { id: string; campaignId: string; title: string; type: string }

const KEY = "master-ai:bookmarks";
const EVT = "master-ai:bookmarks-changed";

function read(): Bookmark[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function write(list: Bookmark[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVT));
}

export function getBookmarks(campaignId?: string): Bookmark[] {
  const all = read();
  return campaignId ? all.filter((b) => b.campaignId === campaignId) : all;
}

export function isBookmarked(id: string): boolean {
  return read().some((b) => b.id === id);
}

// Переключает закладку; возвращает новое состояние (true — добавлена).
export function toggleBookmark(b: Bookmark): boolean {
  const all = read();
  const exists = all.some((x) => x.id === b.id);
  write(exists ? all.filter((x) => x.id !== b.id) : [...all, b]);
  return !exists;
}

export function removeBookmark(id: string): void {
  write(read().filter((b) => b.id !== id));
}

// Реактивный список закладок (обновляется при изменениях в любой части приложения).
export function useBookmarks(campaignId?: string): Bookmark[] {
  const [list, setList] = useState<Bookmark[]>(() => getBookmarks(campaignId));
  useEffect(() => {
    const update = () => setList(getBookmarks(campaignId));
    update();
    window.addEventListener(EVT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVT, update);
      window.removeEventListener("storage", update);
    };
  }, [campaignId]);
  return list;
}
