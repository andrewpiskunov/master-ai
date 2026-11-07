import { useEffect, useRef, useSyncExternalStore } from "react";

let deleted: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => deleted;
export const isImageDeleted = (id: string): boolean => deleted.has(id);

// Все открытые превью исчезают вместе, в том числе дубликаты в переписке.
export function notifyImageDeleted(id: string): void {
  if (deleted.has(id)) return;
  deleted = new Set([...deleted, id]);
  for (const listener of listeners) listener();
}

export function useDeletedImageIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useImageDeletion(onDelete: (id: string) => void): void {
  const ids = useDeletedImageIds();
  const seen = useRef(ids);
  const latest = useRef(onDelete);
  latest.current = onDelete;
  useEffect(() => {
    const previous = seen.current;
    seen.current = ids;
    for (const id of ids) if (!previous.has(id)) latest.current(id);
  }, [ids]);
}
