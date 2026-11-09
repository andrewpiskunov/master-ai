import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronRight, Focus, RotateCcw, Search, SlidersHorizontal, Waypoints, X } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType, type Link } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { documentHref } from "../../lib/document-links.js";
import { docSnippet, TypeBadge, TypeTag, useCampaign } from "./shared.js";
import { buildGraph, filterGraph } from "./graph/model.js";
import { GraphCanvas } from "./graph/GraphCanvas.js";
import "./LinkMap.css";

export function LinkMap() {
  const { campaignId } = useCampaign();
  // Keep filters and selection scoped to this campaign even when the route is reused.
  return <LinkMapExplorer key={campaignId} />;
}
function LinkMapExplorer() {
  const { campaignId, documents, reload } = useCampaign();
  const navigate = useNavigate();
  const [links, setLinks] = useState<Link[]>([]);
  const [linksError, setLinksError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; sequence: number } | null>(null);
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(1);
  const [includeNeighbors, setIncludeNeighbors] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [labels, setLabels] = useState(true);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 620);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 620);
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => { reload(); }, []); // workspace reload is intentionally only on entry
  useEffect(() => {
    let cancelled = false;
    setLinksError(false);
    api.listCampaignLinks(campaignId).then((data) => { if (!cancelled) setLinks(data); })
      .catch(() => { if (!cancelled) setLinksError(true); });
    return () => { cancelled = true; };
  }, [campaignId, retry]);
  const graph = useMemo(() => buildGraph(documents, links), [documents, links]);
  const focusId = local ? selected : null;
  const visible = useMemo(() => filterGraph(graph, { query, hiddenTypes: hidden, includeNeighbors, showOrphans, focusId, depth }), [graph, query, hidden, includeNeighbors, showOrphans, focusId, depth]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const chosen = selected ? byId.get(selected) : undefined;
  const selectedVisible = chosen && visible.nodes.some((n) => n.id === chosen.id) ? chosen : undefined;
  const matched = useMemo(() => query.trim() ? new Set(visible.matches.map((n) => n.id)) : null, [query, visible.matches]);
  const types = DOCUMENT_TYPES.map((type) => ({ ...type, count: documents.filter((d) => d.type === type.key).length })).filter((t) => t.count);
  const related = chosen ? graph.edges.filter((e) => e.source === chosen.id || e.target === chosen.id).map((edge) => ({
    edge, node: byId.get(edge.source === chosen.id ? edge.target : edge.source)!,
  })).sort((a, b) => a.node.document.title.localeCompare(b.node.document.title, "ru")) : [];
  function select(id: string | null, center = true) {
    setSelected(id);
    if (!id) { setLocal(false); setFocus(null); return; }
    const node = byId.get(id);
    if (node && hidden.has(node.document.type)) setHidden((previous) => { const next = new Set(previous); next.delete(node.document.type); return next; });
    if (!visible.nodes.some((n) => n.id === id)) setQuery("");
    if (center) setFocus((previous) => ({ id, sequence: (previous?.sequence ?? 0) + 1 }));
  }
  function reset() { setQuery(""); setHidden(new Set()); setSelected(null); setLocal(false); setDepth(1); setIncludeNeighbors(true); setShowOrphans(true); setLabels(true); }
  function toggleType(type: string) {
    setHidden((previous) => { const next = new Set(previous); if (next.has(type)) next.delete(type); else next.add(type); return next; });
    if (chosen?.document.type === type) { setSelected(null); setLocal(false); }
  }
  return <div className="view view-wide linkmap-view">
    <header className="view-head">
      <Waypoints size={24} strokeWidth={1.8} className="view-head-icon" />
      <div><h1 className="page-title">Карта связей</h1><p className="view-sub">Находите героев, места и сюжетные нити вашей кампании.</p></div>
      <span className="graph-total">{graph.nodes.length} сущностей <span>·</span> {graph.edges.length} связей</span>
    </header>
    <div className="linkmap-layout">
      <aside className="graph-explorer" aria-label="Поиск и фильтры карты">
        <div className="graph-search"><Search size={17} /><input type="search" aria-label="Поиск по названиям и текстам" placeholder="Название или текст…" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); setLocal(false); }} />
          {query && <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")}><X size={15} /></button>}
        </div>
        <details className="graph-filters" open={!narrow}>
          <summary><SlidersHorizontal size={14} /> Фильтры <ChevronRight size={14} /></summary>
          <div className="graph-types" role="group" aria-label="Фильтр по типам">
            {types.map((type) => <button type="button" key={type.key} aria-pressed={!hidden.has(type.key)} className={hidden.has(type.key) ? "is-off" : ""} onClick={() => toggleType(type.key)}>
              <TypeBadge type={type.key} size={23} /><span>{type.label}</span><small>{type.count}</small>
            </button>)}
          </div>
          <div className="graph-options">
            <label><input type="checkbox" checked={includeNeighbors} onChange={(e) => setIncludeNeighbors(e.target.checked)} /> Связи найденного</label>
            <label><input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> Без связей</label>
            <label><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Подписи узлов</label>
          </div>
          <button type="button" className="graph-reset" onClick={reset}><RotateCcw size={12} /> Сбросить фильтры</button>
        </details>
        {linksError && <div className="graph-warning">Явные связи не загрузились. Упоминания в текстах показаны.<button type="button" onClick={() => setRetry((n) => n + 1)}>Повторить</button></div>}
        {selectedVisible ? <section className="graph-inspector" aria-label="Выбранная сущность">
          <button type="button" className="graph-back" onClick={() => select(null)}><ArrowLeft size={13} /> К результатам</button>
          <TypeTag type={selectedVisible.document.type} />
          <h2>{selectedVisible.document.title}</h2>
          <p className="graph-snippet">{docSnippet(selectedVisible.document.contentJson) || "У этой карточки пока нет описания."}</p>
          <RouterLink className="graph-open" to={documentHref(campaignId, selectedVisible.id)}>Открыть карточку <ArrowUpRight size={15} /></RouterLink>
          <button type="button" className="graph-focus" onClick={() => { setQuery(""); setLocal(true); }}><Focus size={15} /> Только связи этой сущности</button>
          <div className="graph-list-heading">Связанные сущности <span>{related.length}</span></div>
          <div className="graph-relations">
            {related.map(({ edge, node }) => <div className="graph-relation" key={node.id}>
              <button type="button" className="graph-result" onClick={() => select(node.id)}><TypeBadge type={node.document.type} size={28} /><span>{node.document.title}<small>{getDocumentType(node.document.type)?.label ?? node.document.type}{hidden.has(node.document.type) ? " · скрыт фильтром" : ""}</small></span><ChevronRight size={14} /></button>
              <div className="graph-reasons">{edge.reasons.map((reason, i) => <p key={i}><span>{reason.from === selectedVisible.id ? reason.label : reason.label === "Упоминает" ? "Упоминается в" : `Входящая связь: ${reason.label}`}</span><small>{reason.excerpt}</small></p>)}</div>
            </div>)}
            {!related.length && <p className="graph-no-relations">Пока нет связей. Упомяните эту сущность по названию в других карточках или добавьте связь в её разделе «Связи».</p>}
          </div>
        </section> : <div className="graph-results">
          <div className="graph-list-heading">{query.trim() ? "Результаты поиска" : "Сущности"}<span>{visible.matches.length}</span></div>
          <div className="graph-result-list">{visible.matches.map((node) => <button type="button" key={node.id} className="graph-result" onClick={() => select(node.id)}>
            <TypeBadge type={node.document.type} size={30} /><span>{node.document.title}<small>{getDocumentType(node.document.type)?.label ?? node.document.type} · {graph.neighbors.get(node.id)?.size ?? 0} связей</small></span><ChevronRight size={14} />
          </button>)}</div>
        </div>}
      </aside>
      <div className="graph-stage">
        <div className="graph-stage-head"><div className="graph-mode"><button type="button" aria-pressed={!local} onClick={() => setLocal(false)}>Вся карта</button><button type="button" aria-pressed={local} disabled={!selectedVisible} onClick={() => { setQuery(""); setLocal(true); }}>Связи сущности</button></div>
          {local && <div className="graph-depth" aria-label="Глубина связей">{[1, 2].map((value) => <button type="button" key={value} aria-pressed={depth === value} onClick={() => setDepth(value)}>{value === 1 ? "1 шаг" : "2 шага"}</button>)}</div>}
          <span className="graph-visible-count" role="status">На карте: {visible.nodes.length} · Связей: {visible.edges.length}</span>
        </div>
        <GraphCanvas graph={graph} visible={visible} selected={selectedVisible?.id ?? null} onSelect={(id) => select(id, false)} onOpen={(id) => navigate(documentHref(campaignId, id))} labels={labels} matched={matched} focus={focus} />
        {!visible.nodes.length && <div className="graph-empty"><Waypoints size={34} strokeWidth={1.2} /><h2>{documents.length ? "Ничего не найдено" : "Пока нет документов для карты"}</h2><p>{documents.length ? "Измените запрос или включите скрытые типы сущностей." : "Создайте карточки и упомяните в них другие сущности по названию."}</p>{!!documents.length && <button type="button" className="btn-ghost" onClick={reset}>Показать всю карту</button>}</div>}
      </div>
    </div>
  </div>;
}
