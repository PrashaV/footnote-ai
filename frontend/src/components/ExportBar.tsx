import { useState, type FC } from "react";
import { toast } from "react-hot-toast";

import { exportDocxAPI } from "../api/client";
import type { ResearchResponse } from "../api/types";

/** Supported export formats. */
export type ExportFormat = "json" | "markdown" | "bibtex" | "pdf" | "docx";

/**
 * Props for {@link ExportBar}.
 */
export interface ExportBarProps {
  /**
   * Fired when the user clicks a client-side export button (json / markdown /
   * bibtex / pdf). The parent owns the serialization so this component stays
   * largely stateless for those formats.
   */
  onExport: (format: Exclude<ExportFormat, "docx">) => void;
  /**
   * The current research response — required to call the backend docx export.
   * When undefined the Word Doc button is disabled.
   */
  researchResponse?: ResearchResponse;
  /**
   * When true, all buttons are disabled (e.g. no research response yet, or
   * an export is already in progress).
   */
  disabled?: boolean;
  /**
   * Which formats to show, in order. Defaults to all five.
   */
  formats?: ExportFormat[];
}

const formatLabels: Record<ExportFormat, string> = {
  json: "JSON",
  markdown: "Markdown",
  bibtex: "BibTeX",
  pdf: "PDF",
  docx: "Word Doc",
};

const DEFAULT_FORMATS: ExportFormat[] = [
  "json",
  "markdown",
  "bibtex",
  "pdf",
  "docx",
];

/**
 * Row of export buttons. Client-side formats (json / markdown / bibtex / pdf)
 * delegate to the parent via `onExport`. The "Word Doc" button calls the
 * backend `/api/export` endpoint directly and triggers a browser download.
 */
const ExportBar: FC<ExportBarProps> = ({
  onExport,
  researchResponse,
  disabled = false,
  formats = DEFAULT_FORMATS,
}) => {
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  const handleDocxExport = async () => {
    if (!researchResponse) return;

    setIsExportingDocx(true);
    try {
      const blob = await exportDocxAPI(researchResponse);

      // Build a safe filename from the topic.
      const safe = researchResponse.topic
        .slice(0, 50)
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      const filename = `footnote_${safe || "research"}.docx`;

      // Trigger browser download.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);

      toast.success("Word document downloaded.");
    } catch {
      toast.error("Export failed — please try again.");
    } finally {
      setIsExportingDocx(false);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Export research response"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3"
    >
      <span className="pr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Export
      </span>

      {formats.map((format) => {
        if (format === "docx") {
          return (
            <button
              key="docx"
              type="button"
              onClick={handleDocxExport}
              disabled={disabled || !researchResponse || isExportingDocx}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExportingDocx ? "Exporting…" : formatLabels.docx}
            </button>
          );
        }

        return (
          <button
            key={format}
            type="button"
            onClick={() => onExport(format as Exclude<ExportFormat, "docx">)}
            disabled={disabled}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {formatLabels[format]}
          </button>
        );
      })}
    </div>
  );
};

export default ExportBar;
