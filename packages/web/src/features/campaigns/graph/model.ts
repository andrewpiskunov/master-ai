import type { Document, Link } from "@master-ai/shared";
import { prepareMentions, matchMentions } from "../../../lib/mentions.js";
import { pmText } from "../../../lib/prosemirror-text.js";

export interface GraphNode { id: string; document: Document; text: string }
export interface RelationReason { from: string; to: string; label: string; excerpt: string }
export interface GraphEdge { source: string; target: string; reasons: RelationReason[] }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; neighbors: Map<string, Set<string>> }
export const normalizeSearch = (text: string) => text.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();

export function buildGraph(documents: Document[], links: Link[] = []): Graph {
  const nodes = documents.map((document) => ({ id: document.id, document, text: pmText(document.contentJson) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbors = new Map(nodes.map((n) => [n.id, new Set<string>()]));
  const edges = new Map<string, GraphEdge>();
  const add = (reason: RelationReason) => {
    if (reason.from === reason.to || !byId.has(reason.from) || !byId.has(reason.to)) return;
    const [source, target] = [reason.from, reason.to].sort();
    const key = JSON.stringify([source, target]);
    const edge = edges.get(key) ?? { source, target, reasons: [] };
    if (!edge.reasons.some((r) => r.from === reason.from && r.to === reason.to && r.label === reason.label)) edge.reasons.push(reason);
    edges.set(key, edge);
    neighbors.get(source)!.add(target); neighbors.get(target)!.add(source);
  };
  const prepared = prepareMentions(nodes.map((n) => ({ title: n.document.title, type: n.document.type, href: n.id })));
  for (const node of nodes) {
    for (const match of matchMentions(node.text, prepared)) {
      const excerpt = `${match.start > 70 ? "…" : ""}${node.text.slice(Math.max(0, match.start - 70), match.end + 100).replace(/\s+/g, " ").trim()}${match.end + 100 < node.text.length ? "…" : ""}`;
      for (const to of match.hrefs ?? (match.href ? [match.href] : [])) add({ from: node.id, to, label: "Упоминает", excerpt });
    }
  }
  for (const link of links) {
    if (byId.get(link.fromDocId)?.document.campaignId !== link.campaignId || byId.get(link.toDocId)?.document.campaignId !== link.campaignId) continue;
    add({ from: link.fromDocId, to: link.toDocId, label: link.kind, excerpt: "Явная связь" });
  }
  return { nodes, edges: [...edges.values()], neighbors };
}

interface GraphFilters { query?: string; hiddenTypes?: Set<string>; includeNeighbors?: boolean; showOrphans?: boolean; focusId?: string | null; depth?: number }
export function filterGraph(graph: Graph, options: GraphFilters): Graph & { matches: GraphNode[] } {
  const eligible = new Set(graph.nodes.filter((n) => !options.hiddenTypes?.has(n.document.type)).map((n) => n.id));
  const adjacent = (id: string) => [...graph.neighbors.get(id) ?? []].filter((other) => eligible.has(other));
  if (options.showOrphans === false) {
    const isolated = [...eligible].filter((id) => !adjacent(id).length);
    isolated.forEach((id) => eligible.delete(id));
  }
  const expand = (seeds: Set<string>, depth: number) => {
    const result = new Set([...seeds].filter((id) => eligible.has(id)));
    let frontier = [...result];
    for (let step = 0; step < depth; step++) {
      const next = frontier.flatMap(adjacent).filter((id) => !result.has(id));
      next.forEach((id) => result.add(id)); frontier = next;
    }
    return result;
  };
  const local = options.focusId ? expand(new Set([options.focusId]), options.depth ?? 1) : eligible;
  const query = normalizeSearch(options.query ?? "");
  const matches = graph.nodes.filter((n) => eligible.has(n.id) && local.has(n.id) && (!query || normalizeSearch(`${n.document.title}\n${n.text}`).includes(query)));
  const visible = query && options.includeNeighbors ? expand(new Set(matches.map((n) => n.id)), 1) : new Set(matches.map((n) => n.id));
  const nodes = graph.nodes.filter((n) => visible.has(n.id) && local.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), neighbors: graph.neighbors,
    matches: matches.sort((a, b) => Number(normalizeSearch(b.document.title).includes(query)) - Number(normalizeSearch(a.document.title).includes(query)) || (graph.neighbors.get(b.id)?.size ?? 0) - (graph.neighbors.get(a.id)?.size ?? 0) || a.document.title.localeCompare(b.document.title, "ru")) };
}
