// App — top-level layout for the Footnote frontend.
//
// Loading-state / error-handling logic lives here:
//
//   - useResearch() exposes { research, data, error, isLoading, isError }.
//     We keep the most recent `ResearchRequest` in state (`lastRequest`) so
//     the Retry button inside ResultsPanel can resubmit it without forcing
//     the user to re-type the topic.
//
//   - A useEffect listens for the mutation flipping into `isError` and
//     surfaces a react-hot-toast error with the API's message. Toasts are
//     keyed by topic so repeated failures on the same query don't stack.
//
//   - ResultsPanel owns the visual states (loading skeletons, error card
//     with retry, and the AnalysisProgress indicator over the 8 sections).
//     All per-panel skeletons are driven by the single `isLoading` flag.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { Toaster, toast } from "react-hot-toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useResearch } from "./hooks/useResearch";
import type { ResearchRequest, ResearchResponse } from "./api/types";
import { saveSession } from "./services/supabase";

import SearchBar from "./components/SearchBar";
import ResultsPanel from "./components/ResultsPanel";
// Code-split KnowledgeGraph: D3 + the graph bundle is heavy (~250 kB gzip).
// React.lazy() defers the chunk download until the component is first needed,
// keeping the initial JS payload lean. The Suspense boundary below renders a
// matching-height skeleton so the layout never shifts during the load.
const KnowledgeGraph = lazy(() => import("./components/KnowledgeGraph"));
import type { GraphNode, GraphLink } from "./components/KnowledgeGraph";
import SessionHistory, { type SessionHistoryHandle } from "./components/SessionHistory";

/**
 * Inner shell that lives under the QueryClientProvider so it can actually
 * call useResearch(). Kept separate so the provider stays at the module
 * boundary and tests can mount AppShell directly with their own client.
 */
const AppShell: FC = () => {
  const { research, data, error, isLoading, isError } = useResearch();

  // Keep the last submitted request so the Retry button can re-fire it.
  const [lastRequest, setLastRequest] = useState<ResearchRequest | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);

  // When the user restores a session from history, we hold the data here.
  // It takes precedence over the live mutation result while set.
  const [restoredData, setRestoredData] = useState<ResearchResponse | null>(null);
  const [restoredTopic, setRestoredTopic] = useState<string | null>(null);

  // Ref to the SessionHistory component so we can ask it to reload after a save.
  const sessionHistoryRef = useRef<SessionHistoryHandle>(null);

  // Track which error we've already surfaced as a toast so we don't
  // double-toast when React re-renders while the mutation is still errored.
  const lastToastedErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isError || !error) {
      // Clear the dedupe ref when we leave the error state so the next
      // failure (even on the same topic) triggers a fresh toast.
      lastToastedErrorRef.current = null;
      return;
    }

    const key = `${lastRequest?.topic ?? ""}::${error.message}`;
    if (lastToastedErrorRef.current === key) return;

    toast.error(error.message || "Research request failed", {
      duration: 6000,
      id: "research-error", // one visible error toast at a time
    });
    lastToastedErrorRef.current = key;
  }, [isError, error, lastRequest]);

  // After a successful live research call, persist the session and refresh history.
  useEffect(() => {
    if (!data || !lastRequest) return;
    saveSession(lastRequest.topic, data).then(() => {
      sessionHistoryRef.current?.refresh();
    });
  // Only run when new data arrives — deliberately omit lastRequest to avoid
  // double-firing if the parent re-renders while `data` stays the same.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSubmit = useCallback(
    (request: ResearchRequest) => {
      setLastRequest(request);
      setSelectedPaperId(null);
      setRestoredData(null);
      setRestoredTopic(null);
      research(request);
    },
    [research],
  );

  const handleRetry = useCallback(
    (request: ResearchRequest) => {
      // Dismiss the current error toast on retry so we don't leak stale UX.
      toast.dismiss("research-error");
      lastToastedErrorRef.current = null;
      setRestoredData(null);
      setRestoredTopic(null);
      research(request);
    },
    [research],
  );

  // Restores a previously-saved session from the SessionHistory sidebar.
  const handleRestore = useCallback(
    (response: ResearchResponse, topic: string) => {
      setRestoredData(response);
      setRestoredTopic(topic);
      setSelectedPaperId(null);
      // Don't touch lastRequest — Retry still works for the last live query.
    },
    [],
  );

  // The active result is either a restored session or the live mutation result.
  const activeData = restoredData ?? data;

  // Derive the graph data from the response.
  // Nodes: papers + authors + concept nodes from key_findings.
  // Links: author→paper (co-authorship), concept→paper (evidence).
  const graphData = deriveGraphData(activeData?.papers, activeData?.key_findings);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Mounted once at the root so any component can call toast(...). */}
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-5">
          <h1 className="text-2xl font-semibold">Footnote</h1>
          <p className="text-sm text-slate-600">
            AI-powered research intelligence
          </p>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        <SearchBar onSubmit={handleSubmit} isLoading={isLoading} />

        {/* Three-column layout: history | results | graph */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-6">
          {/* Session history sidebar */}
          <div className="lg:col-span-1">
            <SessionHistory
              ref={sessionHistoryRef}
              onRestore={handleRestore}
              activeTopic={restoredTopic ?? lastRequest?.topic ?? null}
            />
          </div>

          {/* Results panel */}
          <div className="lg:col-span-3">
            <ResultsPanel
              data={activeData}
              isLoading={isLoading}
              isError={isError}
              error={error}
              lastRequest={lastRequest}
              onRetry={handleRetry}
              selectedPaperId={selectedPaperId}
              onSelectPaper={setSelectedPaperId}
            />
          </div>

          {/* Knowledge graph — lazy-loaded chunk. The Suspense fallback matches
              the 620 px card height so there's no layout shift while the D3
              bundle is downloading on first render. */}
          <div className="lg:col-span-2">
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-live="polite"
                  aria-label="Loading knowledge graph"
                  className="h-[620px] w-full animate-pulse rounded-2xl border border-slate-200 bg-slate-200"
                />
              }
            >
              <KnowledgeGraph graphData={graphData} isLoading={isLoading} />
            </Suspense>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-6 text-xs text-slate-500">
        {activeData?.metadata ? (
          <span>
            {activeData.metadata.model} · {activeData.metadata.depth} ·{" "}
            {activeData.metadata.latency_ms != null
              ? `${activeData.metadata.latency_ms}ms`
              : "—"}
          </span>
        ) : null}
      </footer>
    </div>
  );
};

/**
 * Root component. Owns the QueryClient so every consumer of `useResearch`
 * (and any future query/mutation) shares one cache. We memoize the client so
 * hot-reload doesn't swap it mid-session.
 */
const App: FC = () => {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
};

/**
 * Build a rich graph from the API response:
 *
 *   • paper nodes   — one per returned Paper
 *   • author nodes  — one per unique author name, linked to each paper
 *   • concept nodes — one per KeyFinding claim, linked to the papers cited
 *                     as evidence (source_ids). Concept labels are the first
 *                     60 characters of the claim so they fit in the graph.
 *
 * Returns an empty graph when `papers` is falsy / empty so the D3 component
 * always receives the shape it expects.
 */
function deriveGraphData(
  papers: import("./api/types").Paper[] | undefined,
  keyFindings: import("./api/types").KeyFinding[] | undefined,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  if (!papers || papers.length === 0) return { nodes, links };

  // ── Paper + author nodes ──────────────────────────────────────────────
  const authorIds = new Map<string, string>();

  for (const paper of papers) {
    nodes.push({
      id:       paper.id,
      label:    paper.title.slice(0, 40),
      type:     "paper",
      title:    paper.title,
      abstract: paper.abstract ?? undefined,
      doi:      paper.doi      ?? undefined,
    });

    for (const author of paper.authors ?? []) {
      let aid = authorIds.get(author);
      if (!aid) {
        aid = `author::${author}`;
        authorIds.set(author, aid);
        nodes.push({ id: aid, label: author, type: "author" });
      }
      links.push({
        source:        aid,
        target:        paper.id,
        citationCount: paper.citation_count ?? 1,
      });
    }
  }

  // ── Concept nodes from key findings ──────────────────────────────────
  // Build a set of paper ids present in this response so we only create
  // concept→paper edges for papers that actually exist in the graph.
  const paperIdSet = new Set(papers.map((p) => p.id));

  for (const finding of keyFindings ?? []) {
    const conceptId = `concept::${finding.claim}`;
    const label     = finding.claim.length > 60
      ? `${finding.claim.slice(0, 58)}…`
      : finding.claim;

    nodes.push({
      id:       conceptId,
      label,
      type:     "concept",
      title:    finding.claim,
      abstract: finding.evidence,
    });

    // Link concept → each supporting paper.
    for (const paperId of finding.source_ids) {
      if (paperIdSet.has(paperId)) {
        links.push({ source: conceptId, target: paperId });
      }
    }
  }

  return { nodes, links };
}

export default App;
