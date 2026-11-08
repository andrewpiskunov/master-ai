import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { Maximize, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { typeColor } from "../shared.js";
import type { Graph } from "./model.js";

interface Point { x: number; y: number }
interface PositionedNode extends SimulationNodeDatum { id: string; x: number; y: number }
interface Camera extends Point { k: number }
const clamp = (k: number) => Math.max(0.15, Math.min(4, k));
function layout(graph: Graph): Map<string, Point> {
  const nodes: PositionedNode[] = graph.nodes.map((n) => ({ id: n.id, x: NaN, y: NaN }));
  const simulation = forceSimulation(nodes)
    .force("links", forceLink<PositionedNode, { source: string; target: string }>(graph.edges.map((e) => ({ source: e.source, target: e.target }))).id((n) => n.id).distance(145).strength(0.22))
    .force("charge", forceManyBody().strength(-480))
    .force("collision", forceCollide(55))
    .force("x", forceX(0).strength(0.035)).force("y", forceY(0).strength(0.055)).stop();
  simulation.tick(160);
  return new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

export function GraphCanvas({ graph, visible, selected, onSelect, onOpen, labels, matched, focus }: {
  graph: Graph; visible: Graph; selected: string | null; onSelect: (id: string | null) => void; onOpen: (id: string) => void;
  labels: boolean; matched: Set<string> | null;
  focus?: { id: string; sequence: number } | null;
}) {
  const initial = useMemo(() => layout(graph), [graph]);
  const [placement, setPlacement] = useState({ layout: initial, positions: initial });
  // A replacement graph must render and fit with the same layout in this commit.
  const positions = placement.layout === initial ? placement.positions : initial;
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 900, h: 620 });
  const [hover, setHover] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string | null; start: Point; camera: Camera; position?: Point; moved: boolean; pointer: number } | null>(null);
  const dragged = useRef(false);
  const lastClicked = useRef<string | null>(null);
  const cameraRef = useRef(camera); cameraRef.current = camera;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setSize({ w: element.clientWidth || 900, h: element.clientHeight || 620 });
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const fit = useCallback(() => {
    const points = visible.nodes.map((n) => positions.get(n.id)).filter((p): p is Point => !!p);
    if (!points.length) { setCamera({ x: size.w / 2, y: size.h / 2, k: 1 }); return; }
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const left = Math.min(...xs) - 95, right = Math.max(...xs) + 95;
    const top = Math.min(...ys) - 65, bottom = Math.max(...ys) + 65;
    const k = Math.min(1.5, clamp(Math.min(size.w / (right - left), size.h / (bottom - top)) * 0.9));
    setCamera({ k, x: size.w / 2 - (left + right) / 2 * k, y: size.h / 2 - (top + bottom) / 2 * k });
  }, [visible.nodes, positions, size]);
  const fitRef = useRef(fit); fitRef.current = fit;
  // Refit only when the visible graph or viewport changes, not while dragging a node.
  useEffect(() => { fitRef.current(); }, [visible.nodes, initial, size]);
  useEffect(() => {
    const p = focus && positions.get(focus.id);
    if (p) setCamera((c) => { const k = Math.max(0.85, c.k); return { k, x: size.w / 2 - p.x * k, y: size.h / 2 - p.y * k }; });
  }, [focus]); // Only sidebar navigation moves the camera; a node click must stay under the pointer.
  const zoom = useCallback((factor: number, point?: Point) => {
    setCamera((c) => {
      const p = point ?? { x: size.w / 2, y: size.h / 2 }, k = clamp(c.k * factor), ratio = k / c.k;
      return { k, x: p.x - (p.x - c.x) * ratio, y: p.y - (p.y - c.y) * ratio };
    });
  }, [size]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.0015)), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const id = (event.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    drag.current = { id, start: { x: event.clientX, y: event.clientY }, camera: cameraRef.current, position: id ? positions.get(id) : undefined, moved: false, pointer: event.pointerId };
    dragged.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    if (Math.hypot(dx, dy) < 4 && !current.moved) return;
    current.moved = true; dragged.current = true;
    if (current.id && current.position) {
      const point = { x: current.position.x + dx / current.camera.k, y: current.position.y + dy / current.camera.k };
      setPlacement((previous) => ({ layout: initial, positions: new Map(previous.layout === initial ? previous.positions : initial).set(current.id!, point) }));
    } else setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
  }
  function end(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === "pointerup" && !current.moved) {
      lastClicked.current = current.id;
      onSelect(current.id);
      // Pointer capture retargets click to SVG, even if the pointer started on a node.
      dragged.current = true;
    }
  }
  const active = hover ?? selected;
  const related = active ? new Set([active, ...graph.neighbors.get(active) ?? []]) : null;
  return <div className="graph-canvas" ref={frame}>
    <svg ref={svg} className="graph-svg" aria-label="Граф связей кампании" width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`} tabIndex={0}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onClick={(e) => { if (e.target === e.currentTarget && !dragged.current) onSelect(null); }}
      onDoubleClick={() => { if (lastClicked.current) onOpen(lastClicked.current); }}
      onKeyDown={(e) => {
        if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.25); }
        else if (e.key === "-") { e.preventDefault(); zoom(0.8); }
        else if (e.key === "0") { e.preventDefault(); fit(); }
        else if (e.key === "Escape") onSelect(null);
        else if (e.key.startsWith("Arrow")) {
          e.preventDefault(); const dx = e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
          const dy = e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0;
          setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
        }
      }}>
      <g transform={`translate(${camera.x},${camera.y}) scale(${camera.k})`}>
        {visible.edges.map((edge) => {
          const a = positions.get(edge.source), b = positions.get(edge.target);
          if (!a || !b) return null;
          const lit = active === edge.source || active === edge.target;
          return <line key={`${edge.source}:${edge.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={`graph-edge${lit ? " is-active" : ""}`} style={{ opacity: !active || lit ? 1 : 0.12 }} strokeWidth={(lit ? 1.7 : 1) / camera.k} />;
        })}
        {visible.nodes.map((node) => {
          const p = positions.get(node.id); if (!p) return null;
          const degree = graph.neighbors.get(node.id)?.size ?? 0;
          const r = (5 + Math.min(7, Math.sqrt(degree) * 1.4)) / Math.sqrt(camera.k);
          const lit = active === node.id, dim = related && !related.has(node.id);
          const full = lit || selected === node.id;
          const title = node.document.title;
          return <g key={node.id} data-node-id={node.id} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0}
            aria-label={`Выбрать: ${title}`} aria-pressed={selected === node.id} className={`graph-node${selected === node.id ? " is-selected" : ""}`}
            style={{ opacity: dim ? 0.18 : matched && !matched.has(node.id) && !lit ? 0.55 : 1, color: typeColor(node.document.type) }}
            onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(node.id)} onBlur={() => setHover(null)}
            onClick={(e) => { e.stopPropagation(); if (!dragged.current) onSelect(node.id); }} onDoubleClick={(e) => { e.stopPropagation(); onOpen(node.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(node.id); } }}>
            <title>{title} · {degree} связей</title>
            <circle r={Math.max(17 / camera.k, r + 8 / camera.k)} fill="transparent" />
            {(selected === node.id || lit) && <circle r={r + 5 / camera.k} fill="none" stroke="currentColor" strokeWidth={1.5 / camera.k} opacity={0.5} />}
            <circle className="graph-dot" r={r} fill="currentColor" />
            {(labels || full) && <text textAnchor="middle" y={r + 16 / Math.sqrt(camera.k)} fontSize={12 / Math.sqrt(camera.k)} className={full ? "is-active" : ""}>
              {full || title.length <= 26 ? title : `${title.slice(0, 25)}…`}
            </text>}
          </g>;
        })}
      </g>
    </svg>
    <div className="graph-controls" aria-label="Управление картой">
      <button type="button" title="Приблизить (+)" aria-label="Приблизить" onClick={() => zoom(1.25)}><ZoomIn size={17} /></button>
      <span aria-live="polite">{Math.round(camera.k * 100)}%</span>
      <button type="button" title="Отдалить (−)" aria-label="Отдалить" onClick={() => zoom(0.8)}><ZoomOut size={17} /></button>
      <button type="button" title="Вместить карту (0)" aria-label="Вместить карту" onClick={fit}><Scan size={17} /></button>
      <button type="button" title="На весь экран" aria-label="На весь экран" onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
        else void frame.current?.closest(".linkmap-layout")?.requestFullscreen?.().catch(() => {});
      }}><Maximize size={17} /></button>
    </div>
    <div className="graph-help">Перетаскивайте узлы и карту · Колесо — масштаб · Двойной клик — карточка</div>
  </div>;
}
