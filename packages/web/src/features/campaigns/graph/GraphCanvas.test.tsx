import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "@master-ai/shared";
import { buildGraph } from "./model.js";
import { GraphCanvas } from "./GraphCanvas.js";
const graph = buildGraph([{ id: "a", campaignId: "c", title: "Барон", type: "npc", fields: {}, status: null, contentJson: null, createdAt: "x", updatedAt: "x" } satisfies Document]);
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}
function mount() {
  const select = vi.fn();
  render(<GraphCanvas graph={graph} visible={graph} selected={null} onSelect={select} onOpen={vi.fn()} labels matched={null} />);
  return { select, node: screen.getByRole("button", { name: "Выбрать: Барон" }), svg: screen.getByLabelText("Граф связей кампании") };
}
describe("graph pointer navigation", () => {
  it("selects the pressed node when pointer capture retargets the final click to the SVG", () => {
    const { node, svg, select } = mount();
    pointer(node, "pointerdown", 300, 200); pointer(svg, "pointerup", 300, 200); fireEvent.click(svg);
    expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith("a");
  });
  it("drags a node at the current zoom without opening it or clearing selection", () => {
    const { node, svg, select } = mount();
    const before = node.getAttribute("transform");
    pointer(node, "pointerdown", 300, 200); pointer(svg, "pointermove", 340, 240); pointer(svg, "pointerup", 340, 240); fireEvent.click(svg);
    expect(node.getAttribute("transform")).not.toBe(before);
    expect(select).not.toHaveBeenCalled();
  });
  it("fits newly loaded nodes using their current layout rather than the previous empty map", () => {
    const empty = buildGraph([]);
    const props = { selected: null, onSelect: vi.fn(), onOpen: vi.fn(), labels: true, matched: null };
    const view = render(<GraphCanvas graph={empty} visible={empty} {...props} />);
    const loaded = buildGraph(Array.from({ length: 40 }, (_, i) => ({ ...graph.nodes[0].document, id: `doc${i}`, title: `Карточка ${i}` })));
    view.rerender(<GraphCanvas graph={loaded} visible={loaded} {...props} />);
    const svg = screen.getByLabelText("Граф связей кампании");
    const camera = svg.firstElementChild!.getAttribute("transform")!.match(/-?[\d.]+/g)!.map(Number);
    const points = [...svg.querySelectorAll(".graph-node")].map((n) => n.getAttribute("transform")!.match(/-?[\d.]+/g)!.map(Number));
    expect(points.every(([x, y]) => x * camera[2] + camera[0] > 0 && x * camera[2] + camera[0] < 900 && y * camera[2] + camera[1] > 0 && y * camera[2] + camera[1] < 620)).toBe(true);
  });
  it("allows keyboard selection and keyboard zoom without moving a node", () => {
    const { node, svg, select } = mount();
    fireEvent.keyDown(node, { key: "Enter" }); expect(select).toHaveBeenCalledWith("a");
    const before = svg.firstElementChild?.getAttribute("transform");
    fireEvent.keyDown(svg, { key: "+" }); expect(svg.firstElementChild?.getAttribute("transform")).not.toBe(before);
  });
});
