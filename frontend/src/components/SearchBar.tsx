import { useState, type FC, type FormEvent } from "react";

import type { ResearchDepth, ResearchRequest } from "../api/types";

/**
 * Props for {@link SearchBar}.
 *
 * The bar is a controlled-from-outside primitive: it holds only the in-flight
 * input state (topic string + depth toggle) and hands the full
 * {@link ResearchRequest} up to the parent via `onSubmit`. The parent is
 * expected to own the `useResearch()` mutation and decide what to do with the
 * request (kick off the call, debounce, persist to URL, etc.).
 */
export interface SearchBarProps {
  /** Fired when the user submits a non-empty topic. */
  onSubmit: (request: ResearchRequest) => void;
  /** Disables the submit button — typically wired to `useResearch().isLoading`. */
  isLoading?: boolean;
  /** Pre-fills the topic input (useful when deep-linking from a URL). */
  initialTopic?: string;
  /** Pre-selects the depth. Defaults to `"quick"`. */
  initialDepth?: ResearchDepth;
}

/**
 * Topic + depth input that kicks off a research request.
 *
 * Submits an object shaped like `ResearchRequest` so the parent can pass it
 * straight into `useResearch().research(...)` without reshaping.
 */
const SearchBar: FC<SearchBarProps> = ({
  onSubmit,
  isLoading = false,
  initialTopic = "",
  initialDepth = "quick",
}) => {
  const [topic, setTopic] = useState<string>(initialTopic);
  const [depth, setDepth] = useState<ResearchDepth>(initialDepth);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || isLoading) return;
    onSubmit({ topic: trimmed, depth });
  };

  const canSubmit = topic.trim().length > 0 && !isLoading;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center"
      aria-label="Research topic search"
    >
      <label htmlFor="search-bar-topic" className="sr-only">
        Research topic
      </label>
      <input
        id="search-bar-topic"
        type="text"
        value={topic}
        onChange={(event) => setTopic(event.target.value)}
        placeholder="What do you want to research?"
        autoComplete="off"
        disabled={isLoading}
        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div
        role="radiogroup"
        aria-label="Research depth"
        className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1"
      >
        {(["quick", "deep"] as const).map((option) => {
          const active = depth === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDepth(option)}
              disabled={isLoading}
              className={
                "rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors " +
                (active
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900")
              }
            >
              {option}
            </button>
          );
        })}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isLoading ? "Researching…" : "Research"}
      </button>
    </form>
  );
};

export default SearchBar;
