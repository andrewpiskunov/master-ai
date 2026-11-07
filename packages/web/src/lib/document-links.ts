export function documentHref(campaignId: string, documentId: string): string {
  return `/campaigns/${encodeURIComponent(campaignId)}/documents/${encodeURIComponent(documentId)}`;
}

export function documentIdFromHref(href: string | null | undefined): string | null {
  const match = href && /^\/campaigns\/[^/]+\/documents\/([^/?#]+)(?:[?#].*)?$/.exec(href);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

// Модификаторы, средняя кнопка и контекстное меню принадлежат браузеру.
export function isPlainLinkClick(event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}
