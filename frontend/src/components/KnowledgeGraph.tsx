/**
 * KnowledgeGraph.tsx
 *
 * Full D3 v7 force-directed knowledge graph.
 *
 * Node shapes
 *   paper   → circle   (indigo-500  #6366f1)
 *   author  → diamond  (amber-500   #f59e0b)
 *   concept → hexagon  (emerald-500 #10b981)
 *
 * Features
 *   • Edge stroke-width proportional to citation count (log2-scaled, 1–8 px)
 *   • Click any node → KnowledgeGraphSidebar (title, abstract, DOI)
 *   • d3.zoom() smooth pan & zoom (scroll / pinch; 0.1 – 8 ×)
 *   • Search input: matching nodes stay opaque, others fade to 20 % opacity
 *   • Export PNG via XMLSerializer → Canvas → data-URL anchor download
 *   • Zoom ± toolbar buttons + "Fit" to re-centre after drag
 *   • ResizeObserver: SVG re-fits whenever the container width changes
 *   • Empty-state card when graphData has no nodes
 *   • Node-count badge in the toolbar
 *   • Loading skeleton (pulsing faux nodes) when isLoading = true
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
} from "react";
import * as d3 from "d3";
import KnowledgeGraphSidebar from "./KnowledgeGraphSidebar";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A node in the knowledge graph. Extends d3.SimulationNodeDatum so D3 can
 * mutate x / y / vx / vy / fx / fy in-place during the simulation.
 */
export interface GraphNode extends d3.SimulationNodeDatum {
  /** Unique stable identifier (e.g. DOI, ORCID, slug). */
  id: string;
  /** Human-readable label shown beneath the node shape. */
  label: string;
  /** Determines shape and colour. */
  type: "paper" | "author" | "concept";
  // ── Optional rich fields surfaced in the sidebar ──
  title?: string;
  abstract?: string;
  doi?: string;
}

/**
 * A directed or undirected link between two nodes.
 * `source` / `target` may be node ids (strings) before the simulation
 * resolves them into GraphNode references.
 */
export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  /** Higher values render as a thicker stroke. */
  citationCount?: number;
}

export interface KnowledgeGraphProps {
  graphData: {
    nodes: GraphNode[];
    links: GraphLink[];
  };
  /**
   * When true, render a pulsing skeleton in place of the D3 canvas.
   * Wire to `useResearch().isLoading`.
   */
  isLoading?: boolean;
}

// ── Visual constants ───────────────────────────────────────────────────────

/** Fill colour keyed by node type. */
const NODE_COLOR: Record<GraphNode["type"], string> = {
  paper:   "#6366f1", // indigo-500
  author:  "#f59e0b", // amber-500
  concept: "#10b981", // emerald-500
};

/** Stroke colour keyed by node type (darker shade for contrast). */
const NODE_STROKE: Record<GraphNode["type"], string> = {
  paper:   "#4338ca",
  author:  "#d97706",
  concept: "#059669",
};

/** Bounding radius used by all three node shapes. */
const R = 16;

// ── Shape path helpers ─────────────────────────────────────────────────────

/** Flat-top hexagon path centred at the origin. */
const hexPath = (r: number): string =>
  Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return `${i === 0 ? "M" : "L"}${(r * Math.cos(angle)).toFixed(3)},${(
      r * Math.sin(angle)
    ).toFixed(3)}`;
  }).join("") + "Z";

/** 4-point diamond (rotated square) path centred at the origin. */
const diamondPath = (r: number): string =>
  `M0,${-r} L${(r * 0.72).toFixed(3)},0 L0,${r} L${(-r * 0.72).toFixed(3)},0Z`;

/** Map node type → SVG path string. */
const shapePath = (type: GraphNode["type"]): string => {
  switch (type) {
    case "paper":
      // True circle path (no <circle> so all nodes are uniform <path> elements)
      return `M${R},0 A${R},${R} 0 1,1 ${-R},0 A${R},${R} 0 1,1 ${R},0Z`;
    case "author":
      return diamondPath(R);
    case "concept":
      return hexPath(R);
  }
};

// ── Link width ─────────────────────────────────────────────────────────────

/** Log2-scaled stroke width so very high citation counts don't dominate. */
const linkStrokeWidth = (d: GraphLink): number => {
  const c = d.citationCount ?? 1;
  return Math.max(1, Math.min(8, 1 + Math.log2(c + 1)));
};

// ── Small icon components (inline SVG, shape-accurate for the legend) ──────

const PaperIcon: FC = () => (
  <svg viewBox="-12 -12 24 24" width="14" height="14" aria-hidden="true">
    <circle r="10" fill={NODE_COLOR.paper} stroke={NODE_STROKE.paper} strokeWidth="1.5" />
  </svg>
);

const AuthorIcon: FC = () => (
  <svg viewBox="-12 -12 24 24" width="14" height="14" aria-hidden="true">
    <path d={diamondPath(10)} fill={NODE_COLOR.author} stroke={NODE_STROKE.author} strokeWidth="1.5" />
  </svg>
);

const ConceptIcon: FC = () => (
  <svg viewBox="-12 -12 24 24" width="14" height="14" aria-hidden="true">
    <path d={hexPath(10)} fill={NODE_COLOR.concept} stroke={NODE_STROKE.concept} strokeWidth="1.5" />
  </svg>
);

const LEGEND_ITEMS = [
  { type: "paper"   as const, Icon: PaperIcon,   label: "Papers"   },
  { type: "author"  as const, Icon: AuthorIcon,  label: "Authors"  },
  { type: "concept" as const, Icon: ConceptIcon, label: "Concepts" },
];

// ── Zoom step ──────────────────────────────────────────────────────────────
const ZOOM_STEP = 1.4;

// ── Main exported component (branches loading / live) ─────────────────────

const KnowledgeGraph: FC<KnowledgeGraphProps> = ({
  graphData,
  isLoading = false,
}) => {
  if (isLoading) return <KnowledgeGraphSkeleton />;
  if (graphData.nodes.length === 0) return <KnowledgeGraphEmpty />;
  return <KnowledgeGraphLive graphData={graphData} />;
};

// ── Live D3 graph ──────────────────────────────────────────────────────────

const KnowledgeGraphLive: FC<{ graphData: KnowledgeGraphProps["graphData"] }> = ({
  graphData,
}) => {
  const svgRef       = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef      = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [search, setSearch]             = useState("");

  /**
   * Stable ref to the live D3 node-group selection so the search effect
   * can update opacity without re-running the full simulation setup.
   */
  const nodeSelRef = useRef<d3.Selection<
    SVGGElement,
    GraphNode,
    SVGGElement,
    unknown
  > | null>(null);

  // ── D3 setup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    // Measure container — fall back to sensible defaults.
    let W = svgEl.clientWidth  || 800;
    let H = svgEl.clientHeight || 600;

    // ── Clear previous render ──
    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    // ── Deep-copy data so D3 mutation never corrupts the prop ──
    const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }));
    const links: GraphLink[] = graphData.links.map((l) => ({ ...l }));

    // ── Arrow-head marker ──
    svg
      .append("defs")
      .append("marker")
      .attr("id", "kg-arrow")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", R + 10)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "#94a3b8");

    // ── Zoom layer ──
    const zoomLayer = svg.append("g").attr("class", "kg-zoom");

    // ── Zoom behaviour ──
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        zoomLayer.attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;

    svg
      .call(zoom)
      .on("click.bgDeselect", () => setSelectedNode(null));

    // ── Force simulation ──
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(110)
          .strength(0.6),
      )
      .force("charge",    d3.forceManyBody<GraphNode>().strength(-280))
      .force("center",    d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide<GraphNode>(R + 8))
      .alphaDecay(0.03)
      .velocityDecay(0.4);

    // ── Links ──
    const linkSel = zoomLayer
      .append("g")
      .attr("class", "kg-links")
      .attr("fill", "none")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.55)
      .attr("stroke-width", linkStrokeWidth)
      .attr("marker-end", "url(#kg-arrow)");

    // ── Node groups ──
    const nodeSel = zoomLayer
      .append("g")
      .attr("class", "kg-nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("cursor", "pointer")
      .attr("opacity", 0) // fade-in on first tick
      // ── Accessibility: keyboard navigation ──────────────────────────────
      .attr("tabindex", "0")
      .attr("role", "button")
      .attr("aria-label", (d) => `${d.type} node: ${d.label}`)
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    // ── Append the correct shape to each <g> ──
    nodeSel.each(function (d) {
      const g      = d3.select<SVGGElement, GraphNode>(this);
      const fill   = NODE_COLOR[d.type];
      const stroke = NODE_STROKE[d.type];

      // Larger invisible hit area for easier clicking / touch.
      g.append("circle")
        .attr("r", R + 8)
        .attr("fill", "transparent")
        .attr("stroke", "none");

      // Visible shape.
      g.append("path")
        .attr("d", shapePath(d.type))
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", 2)
        .attr("filter", "drop-shadow(0 1px 2px rgba(0,0,0,0.15))");
    });

    // ── Labels ──
    nodeSel
      .append("text")
      .attr("dy", R + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-family", "system-ui, -apple-system, sans-serif")
      .attr("font-weight", "500")
      .attr("fill", "#475569")
      .attr("pointer-events", "none")
      .text((d) =>
        d.label.length > 22 ? `${d.label.slice(0, 20)}…` : d.label,
      );

    // ── Hover ring ──
    nodeSel
      .on("mouseenter", function () {
        d3.select<SVGGElement, GraphNode>(this)
          .select("path")
          .attr("stroke-width", 3.5);
      })
      .on("mouseleave", function () {
        d3.select<SVGGElement, GraphNode>(this)
          .select("path")
          .attr("stroke-width", 2);
      });

    // ── Click → open sidebar ──
    nodeSel.on("click", (event, d) => {
      event.stopPropagation();
      setSelectedNode(d);
    });

    // ── Keyboard: Enter key triggers the same action as a click ──────────
    nodeSel.on("keydown", (event: KeyboardEvent, d: GraphNode) => {
      if (event.key === "Enter") {
        event.stopPropagation();
        setSelectedNode(d);
      }
    });

    // ── Fade-in once simulation settles ──
    let faded = false;
    simulation.on("tick", () => {
      linkSel
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

      nodeSel.attr(
        "transform",
        (d) => `translate(${d.x ?? 0},${d.y ?? 0})`,
      );

      // Reveal nodes once there's a visible layout (~10 ticks in).
      if (!faded && simulation.alpha() < 0.6) {
        faded = true;
        nodeSel
          .transition()
          .duration(300)
          .attr("opacity", 1);
      }
    });

    // Store selection ref for search effect.
    nodeSelRef.current = nodeSel;

    // ── ResizeObserver: re-centre force on container resize ──
    const ro = new ResizeObserver(([entry]) => {
      W = entry.contentRect.width  || W;
      H = entry.contentRect.height || H;
      simulation.force("center", d3.forceCenter(W / 2, H / 2));
      simulation.alpha(0.3).restart();
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      simulation.stop();
      ro.disconnect();
      nodeSelRef.current = null;
      zoomRef.current    = null;
    };
  }, [graphData]);

  // ── Search: live opacity filter ───────────────────────────────────────────

  useEffect(() => {
    const sel = nodeSelRef.current;
    if (!sel) return;

    const q = search.trim().toLowerCase();

    sel.attr("opacity", (d: GraphNode) => {
      if (!q) return 1;
      const haystack = [d.label, d.title ?? "", d.id].join(" ").toLowerCase();
      return haystack.includes(q) ? 1 : 0.2;
    });
  }, [search]);

  // ── Zoom helpers (toolbar buttons) ───────────────────────────────────────

  const applyZoom = useCallback(
    (factor: number) => {
      const svgEl = svgRef.current;
      const zoom  = zoomRef.current;
      if (!svgEl || !zoom) return;
      d3.select(svgEl).transition().duration(250).call(zoom.scaleBy, factor);
    },
    [],
  );

  const handleZoomIn  = useCallback(() => applyZoom(ZOOM_STEP),        [applyZoom]);
  const handleZoomOut = useCallback(() => applyZoom(1 / ZOOM_STEP),    [applyZoom]);

  const handleFit = useCallback(() => {
    const svgEl = svgRef.current;
    const zoom  = zoomRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl)
      .transition()
      .duration(400)
      .call(zoom.transform, d3.zoomIdentity);
  }, []);

  // ── Export PNG ─────────────────────────────────────────────────────────────

  const handleExportPNG = useCallback(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const { width, height } = svgEl.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;

    const cloned = svgEl.cloneNode(true) as SVGSVGElement;
    cloned.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    cloned.setAttribute("width",  String(width));
    cloned.setAttribute("height", String(height));

    const serializer = new XMLSerializer();
    const svgStr     = serializer.serializeToString(cloned);

    const canvas  = document.createElement("canvas");
    canvas.width  = Math.round(width  * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();

    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      const anchor      = document.createElement("a");
      anchor.download   = "knowledge-graph.png";
      anchor.href       = canvas.toDataURL("image/png");
      anchor.click();
    };

    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const nodeCount = graphData.nodes.length;
  const linkCount = graphData.links.length;

  return (
    <div
      ref={containerRef}
      className="relative flex h-[620px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
    >
      {/* ── Toolbar ── */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">

        {/* Search input */}
        <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 shadow-sm focus-within:ring-2 focus-within:ring-indigo-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5 flex-shrink-0 text-slate-400"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes…"
            className="h-8 w-40 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="text-slate-400 hover:text-slate-600"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5"
                aria-hidden="true"
              >
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          )}
        </label>

        {/* Node / edge count badge */}
        {/* TODO: contrast — text-slate-500 (#64748b) on bg-white: ~4.69:1, passes AA but verify against bg-slate-50 contexts (4.27:1 fail). Consider text-slate-600 for safer margin. */}
        <span className="hidden rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 shadow-sm sm:inline">
          {nodeCount} nodes · {linkCount} edges
        </span>

        {/* Zoom controls */}
        <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <button
            onClick={handleZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex h-8 w-8 items-center justify-center text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors border-r border-slate-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
          </button>
          <button
            onClick={handleZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex h-8 w-8 items-center justify-center text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors border-r border-slate-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path fillRule="evenodd" d="M4 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 10Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={handleFit}
            aria-label="Fit graph to view"
            title="Fit to view"
            className="flex h-8 items-center gap-1 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            Fit
          </button>
        </div>

        {/* Export PNG */}
        <button
          onClick={handleExportPNG}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 active:bg-slate-100 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
            <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
          </svg>
          Export PNG
        </button>
      </div>

      {/* ── Legend ── */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-xs text-slate-600 shadow-sm backdrop-blur-sm">
        {/* TODO: contrast — text-slate-400 (#94a3b8) on bg-white/90 ≈ 2.71:1, fails WCAG AA (4.5:1).
            Consider text-slate-500 (#64748b) on bg-white ≈ 4.69:1 to achieve AA compliance. */}
        <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Legend
        </span>
        {LEGEND_ITEMS.map(({ type, Icon, label }) => (
          <span key={type} className="flex items-center gap-2">
            <Icon />
            <span>{label}</span>
          </span>
        ))}
        {/* TODO: contrast — text-slate-400 (#94a3b8) on bg-white/90 ≈ 2.71:1, fails WCAG AA.
            This is decorative hint text; if considered meaningful, upgrade to text-slate-500. */}
        <span className="mt-1 text-[10px] text-slate-400">
          Scroll to zoom · drag to pan
        </span>
      </div>

      {/* ── D3 SVG canvas ── */}
      <svg
        ref={svgRef}
        className="h-full w-full"
        style={{ display: "block", background: "#f8fafc" }}
        aria-label="Knowledge graph visualisation"
        role="img"
      />

      {/* ── Node detail sidebar (slides in from the right) ── */}
      <div
        className={`absolute inset-y-0 right-0 z-20 w-80 transition-transform duration-300 ease-out ${
          selectedNode ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selectedNode && (
          <KnowledgeGraphSidebar
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────

const KnowledgeGraphEmpty: FC = () => (
  <div className="flex h-[620px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-12 w-12 text-slate-300"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="4"  cy="6"  r="2" />
      <circle cx="20" cy="6"  r="2" />
      <circle cx="4"  cy="18" r="2" />
      <circle cx="20" cy="18" r="2" />
      <line x1="6"  y1="7"  x2="10" y2="11" />
      <line x1="18" y1="7"  x2="14" y2="11" />
      <line x1="6"  y1="17" x2="10" y2="13" />
      <line x1="18" y1="17" x2="14" y2="13" />
    </svg>
    <p className="text-sm font-medium text-slate-400">No graph data yet</p>
    <p className="text-xs text-slate-400">Run a research query to build the knowledge graph.</p>
  </div>
);

// ── Loading skeleton ──────────────────────────────────────────────────────

/**
 * Skeleton placeholder shown while useResearch is in flight.
 * Mimics the 620 px card height so the layout never shifts when the
 * live D3 canvas mounts.
 */
const KnowledgeGraphSkeleton: FC = () => {
  const positions = [
    { top: "18%", left: "22%" }, { top: "12%", left: "62%" },
    { top: "28%", left: "78%" }, { top: "34%", left: "44%" },
    { top: "42%", left: "18%" }, { top: "46%", left: "68%" },
    { top: "52%", left: "32%" }, { top: "56%", left: "82%" },
    { top: "64%", left: "52%" }, { top: "66%", left: "14%" },
    { top: "72%", left: "72%" }, { top: "78%", left: "38%" },
    { top: "24%", left: "36%" }, { top: "38%", left: "88%" },
    { top: "60%", left: "62%" }, { top: "82%", left: "60%" },
  ];

  return (
    <div
      className="relative flex h-[620px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Knowledge graph loading"
    >
      {/* Toolbar skeleton */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <div className="h-8 w-52 animate-pulse rounded-lg bg-slate-200" />
        <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200" />
      </div>

      {/* Legend skeleton */}
      <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5">
        <div className="h-2 w-14 animate-pulse rounded bg-slate-200" />
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="h-3 w-3 animate-pulse rounded-sm bg-slate-200" />
            <div className="h-2 w-16 animate-pulse rounded bg-slate-200" />
          </div>
        ))}
      </div>

      {/* Faux node grid */}
      <div className="relative h-full w-full">
        {positions.map((pos, idx) => (
          <div
            key={idx}
            className="absolute h-8 w-8 animate-pulse rounded-full bg-slate-300"
            style={{ top: pos.top, left: pos.left }}
          />
        ))}
      </div>
    </div>
  );
};

export default KnowledgeGraph;
