// DraftInput — lets users paste a research draft or upload a .txt/.md file.
// Emits a VerifyRequest when the form is submitted.

import { type FC, useState, useRef, useCallback, type ChangeEvent, type DragEvent } from "react";
import type { VerifyRequest } from "../../api/verifyTypes";

interface Props {
  onSubmit: (request: VerifyRequest) => void;
  isLoading: boolean;
}

const MAX_CHARS = 100_000;

const DraftInput: FC<Props> = ({ onSubmit, isLoading }) => {
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [checkCitations, setCheckCitations] = useState(true);
  const [checkAI, setCheckAI] = useState(true);
  const [checkPlagiarism, setCheckPlagiarism] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback((file: File) => {
    setFileError(null);
    if (!file.name.match(/\.(txt|md|tex)$/i)) {
      setFileError("Only .txt, .md, or .tex files are supported.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? "";
      if (text.length > MAX_CHARS) {
        setFileError(`File is too large (max ${MAX_CHARS.toLocaleString()} characters).`);
        return;
      }
      setDraft(text);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 50) return;
    onSubmit({
      draft: trimmed,
      title: title.trim() || undefined,
      check_citations: checkCitations,
      check_ai_writing: checkAI,
      check_plagiarism_risk: checkPlagiarism,
    });
  };

  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const charCount = draft.length;
  const tooShort = draft.trim().length < 50;
  const tooLong = charCount > MAX_CHARS;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Verify Research Draft</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Paste your draft or upload a file. We'll check citations, AI patterns, and
          plagiarism risk.
        </p>
      </div>

      {/* Title field */}
      <div className="mb-3">
        <label htmlFor="draft-title" className="block text-sm font-medium text-slate-700 mb-1">
          Paper Title <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          id="draft-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Effects of Climate Change on Coastal Ecosystems"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800
            placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2
            focus:ring-indigo-200 disabled:opacity-60"
          disabled={isLoading}
          maxLength={300}
        />
      </div>

      {/* Drag-and-drop zone + textarea */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative rounded-xl border-2 border-dashed transition-colors ${
          dragOver
            ? "border-indigo-400 bg-indigo-50"
            : "border-slate-300 bg-slate-50"
        }`}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-indigo-50/80">
            <p className="text-sm font-medium text-indigo-600">Drop file to load draft</p>
          </div>
        )}
        <textarea
          aria-label="Research draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste your research draft here (or drag and drop a .txt / .md file)…"
          rows={14}
          maxLength={MAX_CHARS}
          disabled={isLoading}
          className="w-full resize-y rounded-xl bg-transparent px-4 py-3 text-sm text-slate-800
            placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
        />
      </div>

      {/* Character / word count + file error */}
      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span>{wordCount.toLocaleString()} words</span>
          <span
            className={tooLong ? "text-red-500 font-medium" : ""}
          >
            {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
          </span>
        </div>

        {/* Upload button */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={isLoading}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white
            px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-400
            hover:text-indigo-600 disabled:opacity-50"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Upload file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.tex"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {fileError && (
        <p className="mt-1 text-xs text-red-500">{fileError}</p>
      )}

      {/* Check toggles */}
      <div className="mt-4 flex flex-wrap gap-3">
        {([
          { key: "citations", label: "Citation check", checked: checkCitations, set: setCheckCitations },
          { key: "ai", label: "AI writing detection", checked: checkAI, set: setCheckAI },
          { key: "plagiarism", label: "Plagiarism risk", checked: checkPlagiarism, set: setCheckPlagiarism },
        ] as const).map(({ key, label, checked, set }) => (
          <label
            key={key}
            className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5
              text-sm font-medium transition select-none ${
              checked
                ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                : "border-slate-300 bg-white text-slate-500 hover:border-slate-400"
            } ${isLoading ? "pointer-events-none opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => set(e.target.checked)}
              className="sr-only"
            />
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                checked ? "border-indigo-500 bg-indigo-500" : "border-slate-400 bg-white"
              }`}
            >
              {checked && (
                <svg className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            {label}
          </label>
        ))}
      </div>

      {/* Submit */}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading || tooShort || tooLong}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm
            font-semibold text-white transition hover:bg-indigo-700 focus:outline-none
            focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 disabled:opacity-50
            disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Verifying…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Integrity Check
            </>
          )}
        </button>

        {tooShort && draft.length > 0 && (
          <p className="text-xs text-slate-500">Draft must be at least 50 characters.</p>
        )}
        {tooLong && (
          <p className="text-xs text-red-500">Draft exceeds the 100,000 character limit.</p>
        )}
      </div>
    </div>
  );
};

export default DraftInput;
