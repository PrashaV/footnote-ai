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
  /** Fired when the user submits a valid topic (≥ 3 characters). */
  onSubmit: (request: ResearchRequest) => void;
  /** Disables the submit button — typically wired to `useResearch().isLoading`. */
  isLoading?: boolean;
  /** Pre-fills the topic input (useful when deep-linking from a URL). */
  initialTopic?: string;
  /** Pre-selects the depth. Defaults to `"quick"`. */
  initialDepth?: ResearchDepth;
}

// Mirrors the backend Pydantic constraint on ResearchRequest.topic.
const TOPIC_MIN_LENGTH = 3;
const TOPIC_MAX_LENGTH = 500;

/**
 * Topic + depth input that kicks off a research request.
 *
 * Submits an object shaped like `ResearchRequest` so the parent can pass it
 * straight into `useResearch().research(...)` without reshaping.
 *
 * Client-side validation mirrors the backend Pydantic model so users see
 * friendly inline errors instead of a raw HTTP 422.
 */
const SearchBar: FC<SearchBarProps> = ({
  onSubmit,
  isLoading = false,
  initialTopic = "",
  initialDepth = "quick",
}) => {
  const [topic, setTopic] = useState<string>(initialTopic);
  const [depth, setDepth] = useState<ResearchDepth>(initialDepth);
  const [touched, setTouched] = useState(false);

  const trimmed = topic.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < TOPIC_MIN_LENGTH;
  const tooLong  = trimmed.length > TOPIC_MAX_LENGTH;
  const hasError = tooShort || tooLong;

  const canSubmit =
    trimmed.length >= TOPIC_MIN_LENGTH &&
    trimmed.length <= TOPIC_MAX_LENGTH &&
    !isLoading;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    onSubmit({ topic: trimmed, depth });
  };

  const handleChange = (value: string) => {
    setTopic(value);
    // Only show errors after the user has started typing.
    if (value.trim().length > 0) setTouched(true);
  };

  const validationMessage = (() => {
    if (!touched) return null;
    if (tooShort) return `Topic must be at least ${TOPIC_MIN_LENGTH} characters.`;
    if (tooLong)  return `Topic must be ${TOPIC_MAX_LENGTH} characters or fewer.`;
    return null;
  })();

  return (
    <div className="flex w-full flex-col gap-1">
      <form
        onSubmit={handleSubmit}
        className="flex w-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center"
        aria-label="Research topic search"
        noValidate
      >
        <label htmlFor="search-bar-topic" className="sr-only">
          Research topic
        </label>
        <input
          id="search-bar-topic"
          type="text"
          value={topic}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={() => { if (trimmed.length > 0) setTouched(true); }}
          placeholder="What do you want to research? (min 3 characters)"
          autoComplete="off"
          disabled={isLoading}
          aria-invalid={touched && hasError}
          aria-describedby={validationMessage ? "search-bar-error" : undefined}
          maxLength={TOPIC_MAX_LENGTH}
          className={
            "flex-1 rounded-xl border bg-slate-50 px-4 py-2 text-base text-slate-900 " +
            "placeholder:text-slate-400 focus:bg-white focus:outline-none " +
            "focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 " +
            (touched && hasError
              ? "border-red-400 focus:border-red-400 focus:ring-red-200"
              : "border-slate-200 focus:border-slate-400 focus:ring-slate-300")
          }
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

      {/* Inline validation message — only shown after user interaction */}
      {validationMessage && (
        <p
          id="search-bar-error"
          role="alert"
          className="px-4 text-xs font-medium text-red-600"
        >
          {validationMessage}
        </p>
      )}
    </div>
  );
};

export default SearchBar;
