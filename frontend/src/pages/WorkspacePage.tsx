// WorkspacePage — Phase 3 document editor for Footnote.
//
// Phase 3.2 additions:
//   • CitationExtension wired into TipTap: type "@" to trigger citation search
//   • useCitations hook manages citation state + Supabase persistence
//   • SourcesSidebar now renders the live citations list
//
// Layout:
//   ┌─────────────────────────────────────────────────────────────────────┐
//   │  ← Back    [Document title input .............]  Saved  [Integrity] │  ← top bar (h-14)
//   ├─────────────────────────────────────────────────────────────────────┤
//   │  B I S H1 H2 H3 ≡ ⋮ " </> — ↩ ↪                                  │  ← toolbar
//   ├─────────────────────────────────────────────────────────────────────┤
//   │                                        │ ‹ │  Sources (280 px)     │
//   │   TipTap editor  (flex-1)              │   │  citation list        │
//   └─────────────────────────────────────────────────────────────────────┘

import { type FC, useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { useAuth } from "../contexts/AuthContext";
import { useDocument, type SaveStatus } from "../hooks/useDocument";
import { useCitations } from "../hooks/useCitations";
import { useIntegrityAnalyze } from "../hooks/useIntegrityAnalyze";
import { CitationExtension } from "../components/editor/CitationExtension";
import { AIHighlightExtension, aiHighlightKey } from "../components/editor/AIHighlightExtension";
import { PlagiarismHighlightExtension, plagiarismHighlightKey } from "../components/editor/PlagiarismHighlightExtension";
import SourcesSidebar, { type SidebarTab } from "../components/editor/SourcesSidebar";
import IntegritySidebar from "../components/integrity/IntegritySidebar";
import AuthModal from "../components/AuthModal";

// ---------------------------------------------------------------------------
// Save status helpers
// ---------------------------------------------------------------------------

function statusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving": return "Saving…";
    case "saved":  return "Saved";
    case "error":  return "Error saving";
    default:       return "";
  }
}

function statusColor(status: SaveStatus): string {
  switch (status) {
    case "saving": return "text-slate-400";
    case "saved":  return "text-emerald-500";
    case "error":  return "text-red-500";
    default:       return "text-transparent select-none";
  }
}

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

const ToolbarButton: FC<ToolbarButtonProps> = ({
  onClick, isActive, disabled, title, children,
}) => (
  <button
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-pressed={isActive}
    className={`
      flex h-7 w-7 items-center justify-center rounded text-sm transition-colors
      focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
      disabled:opacity-30
      ${isActive
        ? "bg-indigo-100 text-indigo-700"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }
    `}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// WorkspacePage
// ---------------------------------------------------------------------------

const WorkspacePage: FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("sources");

  // ── Document state + autosave ────────────────────────────────────────────
  const {
    docId,
    saveStatus,
    currentTitle,
    updateTitle,
    updateContent,
  } = useDocument(user?.id ?? null);

  // ── Citations state ──────────────────────────────────────────────────────
  const { citations, isLoading: citationsLoading, addCitation } = useCitations(
    docId,
    user?.id ?? null,
  );

  // ── Integrity check state ────────────────────────────────────────────────
  const {
    results: integrityResults,
    isLoading: integrityLoading,
    error: integrityError,
    run: runIntegrityCheck,
  } = useIntegrityAnalyze();

  // ── Stable ref so the TipTap extension always calls the latest addCitation
  // without needing to reinitialise the editor when docId becomes available ──
  const addCitationRef = useRef(addCitation);
  useEffect(() => { addCitationRef.current = addCitation; }, [addCitation]);

  const stableOnSave = useCallback(
    (item: import("../components/editor/CitationList").CitationItem, text: string) => {
      addCitationRef.current(item, text);
    },
    [], // intentionally empty — reads from ref, never stale
  );

  // Created once — stableOnSave never changes so the editor doesn't reinitialise
  const citationExtension = useMemo(
    () => CitationExtension({ onSave: stableOnSave }),
    [stableOnSave],
  );

  // ── TipTap editor ────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [StarterKit, citationExtension, AIHighlightExtension, PlagiarismHighlightExtension],
    content: "",
    onUpdate: ({ editor }) => {
      updateContent(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class: [
          "prose prose-slate max-w-none focus:outline-none",
          "min-h-[calc(100vh-7rem)]",
          "px-16 py-12",
          "text-slate-800 leading-relaxed",
        ].join(" "),
      },
    },
  });

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((v) => !v);
  }, []);

  // ── Integrity check handler (declared after editor so it's in scope) ─────
  const handleRunIntegrityCheck = useCallback(async () => {
    if (!docId || !editor) return;
    // Use empty block separator so character offsets match ProseMirror
    // doc.textContent — the same coordinate space the backend uses for
    // flagged_sections start_char / end_char values.
    const content = editor.getText({ blockSeparator: "" });
    if (!content.trim()) return;

    // Map CitationRow → CitationRef shape expected by the API
    const citationRefs = citations.map((c) => ({
      id: c.id,
      raw_text: c.inserted_text,
      title: c.title,
      authors: c.authors ?? [],
      year: c.year ?? undefined,
      doi: c.doi ?? undefined,
    }));

    // Switch to the Integrity tab and open sidebar if collapsed
    setSidebarTab("integrity");
    setSidebarOpen(true);

    await runIntegrityCheck(docId, content, citationRefs);
  }, [docId, editor, citations, runIntegrityCheck]);

  // ── Apply AI highlight decorations when results arrive ───────────────────
  useEffect(() => {
    if (!editor?.view) return;

    const sections = integrityResults?.ai_detection?.flagged_sections ?? [];
    editor.view.dispatch(
      editor.view.state.tr.setMeta(aiHighlightKey, { sections }),
    );
  }, [editor, integrityResults]);

  // ── Apply plagiarism highlight decorations (red underlines) ──────────────
  useEffect(() => {
    if (!editor?.view) return;

    // Use flagged_sections from plagiarism_check (same character-offset space)
    const sections = integrityResults?.plagiarism_check?.flagged_sections ?? [];
    editor.view.dispatch(
      editor.view.state.tr.setMeta(plagiarismHighlightKey, { sections }),
    );
  }, [editor, integrityResults]);

  // ── Auth loading ─────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  // ── Auth guard ───────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-100">
        <header className="flex h-14 items-center border-b border-slate-200 bg-white px-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Footnote
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-4">
            <div className="text-center">
              <h2 className="text-xl font-bold text-indigo-700">Sign in to access Workspace</h2>
              <p className="mt-1 text-sm text-slate-500">
                Your documents are saved securely to your account.
              </p>
            </div>
            <AuthModal onClose={() => navigate("/")} />
          </div>
        </div>
      </div>
    );
  }

  // ── Full editor layout ───────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-white">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <button
          onClick={() => navigate("/")}
          aria-label="Back to Footnote"
          title="Back to Footnote"
          className="
            flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1.5
            text-xs font-medium text-slate-500 transition-colors
            hover:bg-slate-100 hover:text-slate-800
            focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
          "
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Footnote
        </button>

        <div className="h-5 w-px bg-slate-200" aria-hidden="true" />

        <input
          type="text"
          value={currentTitle}
          onChange={(e) => updateTitle(e.target.value)}
          placeholder="Untitled Document"
          aria-label="Document title"
          className="
            min-w-0 flex-1 bg-transparent text-sm font-semibold
            text-slate-800 placeholder-slate-400
            outline-none focus:ring-0
          "
        />

        <span
          aria-live="polite"
          aria-atomic="true"
          className={`flex-shrink-0 text-xs font-medium transition-colors ${statusColor(saveStatus)}`}
        >
          {statusLabel(saveStatus) || "—"}
        </span>

        <button
          onClick={handleRunIntegrityCheck}
          disabled={integrityLoading || !docId}
          title={!docId ? "Save your document first" : "Run all four integrity checks on this document"}
          aria-busy={integrityLoading}
          className="
            flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-indigo-300
            bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-600
            transition-colors hover:bg-indigo-100 hover:border-indigo-400
            focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {integrityLoading ? (
            <>
              <svg
                className="h-3 w-3 animate-spin text-indigo-500"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Checking…
            </>
          ) : (
            "Run Integrity Check"
          )}
        </button>
      </header>

      {/* ── Formatting toolbar ───────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-0.5 border-b border-slate-100 bg-white px-4 py-1.5">
        <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} isActive={editor?.isActive("bold")} disabled={!editor} title="Bold (⌘B)">
          <strong className="text-xs">B</strong>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} isActive={editor?.isActive("italic")} disabled={!editor} title="Italic (⌘I)">
          <em className="text-xs">I</em>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleStrike().run()} isActive={editor?.isActive("strike")} disabled={!editor} title="Strikethrough">
          <s className="text-xs">S</s>
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />

        <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} isActive={editor?.isActive("heading", { level: 1 })} disabled={!editor} title="Heading 1">
          <span className="text-xs font-bold">H1</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor?.isActive("heading", { level: 2 })} disabled={!editor} title="Heading 2">
          <span className="text-xs font-bold">H2</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor?.isActive("heading", { level: 3 })} disabled={!editor} title="Heading 3">
          <span className="text-xs font-bold">H3</span>
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />

        <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} isActive={editor?.isActive("bulletList")} disabled={!editor} title="Bullet list">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} isActive={editor?.isActive("orderedList")} disabled={!editor} title="Numbered list">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} isActive={editor?.isActive("blockquote")} disabled={!editor} title="Blockquote">
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V8H3V6zm9 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-3a1 1 0 01-1-1V8h-1V6z" />
          </svg>
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />

        <ToolbarButton onClick={() => editor?.chain().focus().toggleCodeBlock().run()} isActive={editor?.isActive("codeBlock")} disabled={!editor} title="Code block">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().setHorizontalRule().run()} isActive={false} disabled={!editor} title="Horizontal rule">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />
          </svg>
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />

        <ToolbarButton onClick={() => editor?.chain().focus().undo().run()} disabled={!editor?.can().undo()} title="Undo (⌘Z)">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v1M3 10l4-4m-4 4l4 4" />
          </svg>
        </ToolbarButton>
        <ToolbarButton onClick={() => editor?.chain().focus().redo().run()} disabled={!editor?.can().redo()} title="Redo (⌘⇧Z)">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v1M21 10l-4-4m4 4l-4 4" />
          </svg>
        </ToolbarButton>

        {/* Citation hint */}
        <div className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500">@</kbd>
          <span>to cite a paper</span>
        </div>
      </div>

      {/* ── Editor + sidebar ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 overflow-y-auto bg-white">
          <div className="mx-auto w-full max-w-3xl">
            <EditorContent editor={editor} />
          </div>
        </div>

        <SourcesSidebar
          isOpen={sidebarOpen}
          onToggle={handleToggleSidebar}
          citations={citations}
          isLoading={citationsLoading}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          integrityHasResults={!!integrityResults}
          integrityContent={
            <IntegritySidebar
              results={integrityResults}
              isLoading={integrityLoading}
              error={integrityError}
            />
          }
        />
      </div>
    </div>
  );
};

export default WorkspacePage;
