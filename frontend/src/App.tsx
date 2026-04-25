// App — top-level layout for the Footnote frontend.
//
// v2.0 adds:
//   • Tabs: "Research" (original feature) and "Verify" (Academic Integrity Engine)
//   • AuthProvider wrapping the whole app for Supabase Auth
//   • Integrity Engine: DraftInput → useVerify → IntegrityDashboard
//   • Auto-save integrity reports to Supabase on completion
//   • User avatar / sign-in button in header

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { Toaster, toast } from "react-hot-toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useResearch } from "./hooks/useResearch";
import { useVerify } from "./hooks/useVerify";
import type { ResearchRequest, ResearchResponse } from "./api/types";
import type { VerifyRequest } from "./api/verifyTypes";
import { saveSession, saveIntegrityReport } from "./services/supabase";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

import SearchBar from "./components/SearchBar";
import ResultsPanel from "./components/ResultsPanel";
import SessionHistory, { type SessionHistoryHandle } from "./components/SessionHistory";
import AuthModal from "./components/AuthModal";
import DraftInput from "./components/integrity/DraftInput";
import IntegrityDashboard from "./components/integrity/IntegrityDashboard";

const KnowledgeGraph = lazy(() => import("./components/KnowledgeGraph"));
import type { GraphNode, GraphLink } from "./components/KnowledgeGraph";

// ---------------------------------------------------------------------------
// App tabs
// ---------------------------------------------------------------------------

type AppTab = "research" | "verify";

// ---------------------------------------------------------------------------
// Inner shell (under QueryClientProvider + AuthProvider)
// ---------------------------------------------------------------------------

const AppShell: FC = () => {
  const { research, data, error, isLoading, isError } = useResearch();
  const { verify, data: integrityReport, error: verifyError, isLoading: isVerifying, isError: isVerifyError, reset: resetVerify } = useVerify();
  const { user, isLoading: authLoading, signOut } = useAuth();

  const [activeTab, setActiveTab] = useState<AppTab>("research");
  const [showAuth, setShowAuth] = useState(false);

  // Research tab state
  const [lastRequest, setLastRequest] = useState<ResearchRequest | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [restoredData, setRestoredData] = useState<ResearchResponse | null>(null);
  const [restoredTopic, setRestoredTopic] = useState<string | null>(null);
  const sessionHistoryRef = useRef<SessionHistoryHandle>(null);
  const lastToastedErrorRef = useRef<string | null>(null);
  const lastToastedVerifyErrorRef = useRef<string | null>(null);

  // ── Research error toasts ──────────────────────────────────────────────
  useEffect(() => {
    if (!isError || !error) {
      lastToastedErrorRef.current = null;
      return;
    }
    const key = `${lastRequest?.topic ?? ""}::${error.message}`;
    if (lastToastedErrorRef.current === key) return;
    toast.error(error.message || "Research request failed", {
      duration: 6000, id: "research-error",
    });
    lastToastedErrorRef.current = key;
  }, [isError, error, lastRequest]);

  // ── Verify error toasts ────────────────────────────────────────────────
  useEffect(() => {
    if (!isVerifyError || !verifyError) {
      lastToastedVerifyErrorRef.current = null;
      return;
    }
    const key = verifyError.message;
    if (lastToastedVerifyErrorRef.current === key) return;
    toast.error(verifyError.message || "Verification failed", {
      duration: 6000, id: "verify-error",
    });
    lastToastedVerifyErrorRef.current = key;
  }, [isVerifyError, verifyError]);

  // ── Save research session after success ───────────────────────────────
  useEffect(() => {
    if (!data || !lastRequest) return;
    saveSession(lastRequest.topic, data, user?.id).then(() => {
      sessionHistoryRef.current?.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Save integrity report after success ───────────────────────────────
  useEffect(() => {
    if (!integrityReport) return;
    saveIntegrityReport(integrityReport, user?.id ?? undefined).then((saved) => {
      if (saved) {
        toast.success("Integrity report saved.", { id: "report-saved", duration: 3000 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrityReport]);

  // ── Research handlers ─────────────────────────────────────────────────
  const handleSubmit = useCallback((request: ResearchRequest) => {
    setLastRequest(request);
    setSelectedPaperId(null);
    setRestoredData(null);
    setRestoredTopic(null);
    research(request);
  }, [research]);

  const handleRetry = useCallback((request: ResearchRequest) => {
    toast.dismiss("research-error");
    lastToastedErrorRef.current = null;
    setRestoredData(null);
    setRestoredTopic(null);
    research(request);
  }, [research]);

  const handleRestore = useCallback((response: ResearchResponse, topic: string) => {
    setRestoredData(response);
    setRestoredTopic(topic);
    setSelectedPaperId(null);
  }, []);

  // ── Verify handler ────────────────────────────────────────────────────
  const handleVerify = useCallback((request: VerifyRequest) => {
    resetVerify();
    verify(request);
  }, [verify, resetVerify]);

  const activeData = restoredData ?? data;
  const graphData = deriveGraphData(activeData?.papers, activeData?.key_findings);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold text-indigo-700">Footnote</h1>
            <p className="text-xs text-slate-500">Academic Integrity Engine</p>
          </div>

          {/* Tab switcher */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
            <button
              onClick={() => setActiveTab("research")}
              className={`px-4 py-2 transition ${
                activeTab === "research"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Research
            </button>
            <button
              onClick={() => setActiveTab("verify")}
              className={`px-4 py-2 transition ${
                activeTab === "verify"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              ✓ Verify Draft
            </button>
          </div>

          {/* Auth control */}
          {!authLoading && (
            user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 hidden sm:block">{user.email}</span>
                <button
                  onClick={() => signOut()}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs
                    font-medium text-slate-600 hover:border-slate-400 transition"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth((v) => !v)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold
                  text-white transition hover:bg-indigo-700"
              >
                Sign in
              </button>
            )
          )}
        </div>
      </header>

      {/* ── Auth panel (inline, dismissible) ───────────────────────────── */}
      {showAuth && !user && (
        <div className="mx-auto max-w-sm mt-4 px-4">
          <AuthModal onClose={() => setShowAuth(false)} />
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
        {/* ── RESEARCH TAB ─────────────────────────────────────────────── */}
        {activeTab === "research" && (
          <>
            <SearchBar onSubmit={handleSubmit} isLoading={isLoading} />
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-6">
              <div className="lg:col-span-1">
                <SessionHistory
                  ref={sessionHistoryRef}
                  onRestore={handleRestore}
                  activeTopic={restoredTopic ?? lastRequest?.topic ?? null}
                />
              </div>
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
              <div className="lg:col-span-2">
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-live="polite"
                      aria-label="Loading knowledge graph"
                      className="h-[620px] w-full animate-pulse rounded-2xl border
                        border-slate-200 bg-slate-200"
                    />
                  }
                >
                  <KnowledgeGraph graphData={graphData} isLoading={isLoading} />
                </Suspense>
              </div>
            </section>
          </>
        )}

        {/* ── VERIFY TAB ───────────────────────────────────────────────── */}
        {activeTab === "verify" && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Input: 2/5 columns */}
            <div className="lg:col-span-2">
              <DraftInput onSubmit={handleVerify} isLoading={isVerifying} />
            </div>

            {/* Report: 3/5 columns */}
            <div className="lg:col-span-3">
              {(integrityReport || isVerifying) ? (
                <IntegrityDashboard
                  report={integrityReport!}
                  isLoading={isVerifying}
                />
              ) : (
                <div className="flex h-full min-h-[300px] items-center justify-center
                  rounded-2xl border border-dashed border-slate-300 bg-white">
                  <div className="text-center space-y-2 px-8">
                    <div className="mx-auto h-12 w-12 flex items-center justify-center
                      rounded-full bg-indigo-50">
                      <svg className="h-6 w-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-slate-600">
                      Your integrity report will appear here
                    </p>
                    <p className="text-xs text-slate-400">
                      Paste a draft on the left and click "Run Integrity Check"
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="mx-auto max-w-6xl px-6 py-6 text-xs text-slate-400">
        {activeTab === "research" && activeData?.metadata ? (
          <span>
            {activeData.metadata.model} · {activeData.metadata.depth} ·{" "}
            {activeData.metadata.latency_ms != null
              ? `${activeData.metadata.latency_ms}ms`
              : "—"}
          </span>
        ) : activeTab === "verify" && integrityReport?.metadata ? (
          <span>
            {integrityReport.metadata.model} ·{" "}
            {integrityReport.metadata.word_count != null
              ? `${integrityReport.metadata.word_count.toLocaleString()} words`
              : "—"}
            {" · "}
            {integrityReport.metadata.latency_ms != null
              ? `${(integrityReport.metadata.latency_ms / 1000).toFixed(1)}s`
              : ""}
          </span>
        ) : null}
      </footer>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Root — owns QueryClient + AuthProvider
// ---------------------------------------------------------------------------

const App: FC = () => {
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  );
};

// ---------------------------------------------------------------------------
// Graph data derivation (unchanged from v1)
// ---------------------------------------------------------------------------

function deriveGraphData(
  papers: import("./api/types").Paper[] | undefined,
  keyFindings: import("./api/types").KeyFinding[] | undefined,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  if (!papers || papers.length === 0) return { nodes, links };

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

    for (const paperId of finding.source_ids) {
      if (paperIdSet.has(paperId)) {
        links.push({ source: conceptId, target: paperId });
      }
    }
  }

  return { nodes, links };
}

export default App;
