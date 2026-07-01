import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Waypoints } from "lucide-react";
import { getDocumentType } from "@master-ai/shared";
import { prepareMentions, matchMentions } from "../../mentions.js";
import { pmText } from "../../prosemirror-text.js";
import { typeColor, useCampaign } from "./shared.js";

// Карта связей кампании: узлы — документы, рёбра — упоминания одного в тексте другого.
// Раскладка круговая, рендер — inline SVG (без внешних зависимостей).
export function LinkMap() {
  const { campaignId, documents, reload } = useCampaign();
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);

  // Обновляем документы при открытии карты, чтобы она отражала свежие связи/правки.
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { nodes, edges, size } = useMemo(() => {
    const docs = documents;
    const n = docs.length;
    const R = Math.max(150, n * 26);
    const cx = R + 90;
    const cy = R + 40;
    const pos = new Map<string, { x: number; y: number }>();
    const nodes = docs.map((d, i) => {
      const a = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2;
      const x = cx + R * Math.cos(a);
      const y = cy + R * Math.sin(a);
      pos.set(d.id, { x, y });
      return { id: d.id, x, y, title: d.title, type: d.type };
    });
    // Рёбра из упоминаний (неориентированные, без дублей).
    const prepared = prepareMentions(docs.map((d) => ({ title: d.title, type: d.type, href: d.id })));
    const seen = new Set<string>();
    const edges: { a: string; b: string }[] = [];
    for (const d of docs) {
      const hits = new Set(matchMentions(pmText(d.contentJson), prepared).map((m) => m.href).filter((h): h is string => !!h && h !== d.id));
      for (const other of hits) {
        const key = [d.id, other].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: d.id, b: other });
      }
    }
    return { nodes, edges, pos, size: { w: cx + R + 90, h: cy + R + 40 } };
  }, [documents]);

  if (documents.length === 0) {
    return (
      <div className="view"><header className="view-head"><Waypoints size={24} className="view-head-icon" /><div><h1 className="page-title">Карта связей</h1><p className="view-sub">Пока нет документов для карты.</p></div></header></div>
    );
  }

  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const connected = (id: string) => hover === null || hover === id || edges.some((e) => (e.a === hover && e.b === id) || (e.b === hover && e.a === id));

  return (
    <div className="view view-wide">
      <header className="view-head">
        <Waypoints size={24} strokeWidth={1.8} className="view-head-icon" />
        <div>
          <h1 className="page-title">Карта связей</h1>
          <p className="view-sub">Узлы — документы, линии — упоминания по названию. Клик — открыть.</p>
        </div>
      </header>
      <div className="linkmap-wrap">
        <svg className="linkmap" viewBox={`0 0 ${size.w} ${size.h}`} width={size.w} height={size.h}>
          {edges.map((e, i) => {
            const a = byId.get(e.a);
            const b = byId.get(e.b);
            if (!a || !b) return null;
            const active = hover === null || hover === e.a || hover === e.b;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-soft)" strokeWidth={active ? 1.5 : 0.6} opacity={active ? 0.9 : 0.25} />;
          })}
          {nodes.map((nd) => {
            const dim = !connected(nd.id);
            return (
              <g key={nd.id} className="linkmap-node" opacity={dim ? 0.3 : 1}
                 onMouseEnter={() => setHover(nd.id)} onMouseLeave={() => setHover(null)}
                 onClick={() => navigate(`/campaigns/${campaignId}/documents/${nd.id}`)}>
                <circle cx={nd.x} cy={nd.y} r={7} fill={typeColor(nd.type)} stroke="var(--bg)" strokeWidth={2} />
                <text x={nd.x + 11} y={nd.y + 4} fill="var(--text)" fontSize={12}>{nd.title}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
