import { describe, expect, it } from "vitest";
import type { Document } from "@master-ai/shared";
import { buildGraph, filterGraph } from "./model.js";
const doc = (id: string, title: string, text = "", type = "npc"): Document => ({ id, title, type, campaignId: "c1", status: null, fields: {}, createdAt: "x", updatedAt: "x", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });
describe("relationship graph", () => {
  it("deduplicates reciprocal mentions but retains both directions and their evidence", () => {
    const g = buildGraph([doc("a", "Барон", "Причал. Причал."), doc("b", "Причал", "Барон")]);
    expect(g.edges).toHaveLength(1); expect(g.edges[0].reasons).toEqual([
      { from: "a", to: "b", label: "Упоминает", excerpt: "Причал. Причал." },
      { from: "b", to: "a", label: "Упоминает", excerpt: "Барон" },
    ]);
    expect(g.neighbors.get("a")).toEqual(new Set(["b"]));
  });
  it("keeps duplicate-name documents and ignores self, dangling and foreign links", () => {
    const docs = [doc("a", "Барон"), doc("b", "Барон"), doc("c", "Причал", "Барон")];
    const links = [
      { id: "one", campaignId: "c1", fromDocId: "a", toDocId: "a", kind: "self" },
      { id: "two", campaignId: "c1", fromDocId: "a", toDocId: "absent", kind: "missing" },
      { id: "three", campaignId: "c2", fromDocId: "a", toDocId: "b", kind: "foreign" },
    ];
    expect(buildGraph(docs, links).edges.map((e) => [e.source, e.target])).toEqual([["a", "c"], ["b", "c"]]);
  });
  it("searches titles and body case/ё-insensitively without including hidden-type neighbors", () => {
    const g = buildGraph([doc("a", "Шёпот", "Причал"), doc("b", "Причал", "", "location"), doc("c", "Отшельник")]);
    const result = filterGraph(g, { query: "ШЕПОТ", includeNeighbors: true, hiddenTypes: new Set(["location"]) });
    expect(result.nodes.map((n) => n.id)).toEqual(["a"]); expect(result.matches.map((n) => n.id)).toEqual(["a"]);
  });
  it("limits local graphs to the requested depth, and handles missing focus and empty input", () => {
    const g = buildGraph([doc("a", "Барон", "Причал"), doc("b", "Причал", "Башня"), doc("c", "Башня")]);
    expect(filterGraph(g, { focusId: "a", depth: 1 }).nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(filterGraph(g, { focusId: "a", depth: 2 }).nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(filterGraph(g, { focusId: "absent" }).nodes).toEqual([]);
    expect(filterGraph(buildGraph([]), {}).nodes).toEqual([]);
  });
});
