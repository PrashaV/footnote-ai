# GitHub Issues to Create

Paste each issue below into GitHub via **Issues → New Issue**. Assign labels and milestones as indicated. Create the milestones first if they don't exist yet (suggested milestones: `v0.2 – Integrations`, `v0.3 – UX Polish`, `v0.4 – Quality & Testing`).

---

## Issue 1: Zotero Export

**Labels:** `feature`, `integrations`
**Milestone:** `v0.2 – Integrations`

**Description:**

Users should be able to export a selected set of papers from Footnote directly into their Zotero library.

**Acceptance criteria:**
- Add an "Export to Zotero" button in the paper list / detail view
- Use the Zotero Web API (v3) to push items; support both personal and group libraries
- Map Footnote paper metadata (title, authors, DOI, abstract, publication year) to Zotero item fields
- Display success/failure feedback inline (no full-page reload)
- Store the Zotero API key in user settings, not hardcoded
- Write at least one integration test against the Zotero API sandbox

**Out of scope for this issue:** BibTeX / RIS export (separate issue).

---

## Issue 2: Mobile Responsive Layout

**Labels:** `bug`, `ux`, `frontend`
**Milestone:** `v0.3 – UX Polish`

**Description:**

The current layout breaks on viewports narrower than ~900px. Sidebar navigation overlaps content, tables overflow horizontally, and the search bar is clipped on iOS Safari.

**Acceptance criteria:**
- All pages render correctly at 375px, 414px, and 768px widths
- Sidebar collapses to a hamburger menu on mobile
- Paper cards stack vertically rather than side-by-side below 640px
- No horizontal scroll on any page at any viewport width
- Touch targets (buttons, links) are at least 44×44px
- Test on Chrome Mobile emulation and physical iOS/Android if possible

**Reference breakpoints:** follow the existing Tailwind `sm` / `md` / `lg` config.

---

## Issue 3: OpenAlex Integration

**Labels:** `feature`, `integrations`, `backend`
**Milestone:** `v0.2 – Integrations`

**Description:**

Integrate the [OpenAlex API](https://docs.openalex.org/) as an additional paper discovery source alongside any existing sources (e.g. Semantic Scholar, CrossRef).

**Acceptance criteria:**
- New `OpenAlexClient` class in `app/integrations/openalex.py` with async HTTP support
- Implement search by keyword, DOI lookup, and author works listing
- Normalize OpenAlex `Work` objects to the internal `Paper` schema
- Respect OpenAlex rate limits and implement exponential backoff on 429s
- Add a feature flag (`ENABLE_OPENALEX=true/false`) in `.env.example`
- Unit tests with mocked HTTP responses; integration test hitting the live API (marked `@pytest.mark.integration`)

---

## Issue 4: Dark / Light Mode Toggle

**Labels:** `feature`, `ux`, `frontend`
**Milestone:** `v0.3 – UX Polish`

**Description:**

Add a system-aware dark/light mode with a manual override toggle so users can switch regardless of their OS preference.

**Acceptance criteria:**
- Auto-detect system color scheme via `prefers-color-scheme` on first load
- Provide a toggle button (sun/moon icon) in the top navigation bar
- Persist the user's choice in `localStorage` and respect it on subsequent visits
- All existing UI components look correct in both modes (no invisible text, no low-contrast elements)
- No flash of unstyled/wrong-theme content on page load
- Implement using Tailwind's `dark:` variant (already in use) or CSS custom properties — do not add a new theming library

---

## Issue 5: Playwright End-to-End Tests

**Labels:** `testing`, `dx`
**Milestone:** `v0.4 – Quality & Testing`

**Description:**

Set up Playwright for E2E testing to cover core user flows that unit tests cannot reliably catch.

**Acceptance criteria:**
- Install and configure Playwright in `frontend/` (or a top-level `e2e/` folder)
- Add the following test scenarios as a starting baseline:
  - User can search for a paper and see results
  - User can open a paper detail view
  - User can ask a follow-up question and receive a streamed response
  - User can export / save a paper to their list
- Tests run in headless Chromium in CI (GitHub Actions)
- Add `npm run test:e2e` script to `package.json`
- Document how to run locally in `CONTRIBUTING.md`

---

## Issue 6: Accessibility Audit

**Labels:** `accessibility`, `ux`, `frontend`
**Milestone:** `v0.3 – UX Polish`

**Description:**

Conduct a systematic accessibility audit of the UI and fix all critical and serious violations to meet WCAG 2.1 AA compliance.

**Acceptance criteria:**
- Run `axe-core` (via `@axe-core/react` or `axe-playwright`) against all major pages and capture a baseline report
- Fix all `critical` and `serious` violations (minor/moderate are stretch goals)
- Common areas to check: color contrast ratios, alt text on images, keyboard navigation order, ARIA labels on icon-only buttons, focus indicators visible, form inputs labelled
- Add `axe-playwright` assertions to at least two Playwright E2E tests so regressions are caught in CI
- Document any known remaining issues as follow-up GitHub Issues

---

## Issue 7: Rate Limiting UI Feedback

**Labels:** `ux`, `frontend`, `backend`
**Milestone:** `v0.3 – UX Polish`

**Description:**

When a user hits an API rate limit (either Footnote's own backend rate limiter or an upstream provider such as OpenAI), the app currently shows a generic error or no feedback at all. Users need clear, actionable messaging.

**Acceptance criteria:**
- Backend returns a structured `429` response with `retry_after` (seconds) in the JSON body
- Frontend detects `429` responses from any API call
- Display a non-blocking toast / banner: *"Rate limit reached. You can try again in X seconds."* with a countdown timer
- The timer updates in real-time and auto-dismisses when the cooldown expires (optionally auto-retrying the last request)
- For streaming endpoints, gracefully close the stream and show the same message
- Unit test the frontend component with mocked 429 responses

---

## Issue 8: Citation Network Visualization

**Labels:** `feature`, `frontend`, `backend`
**Milestone:** `v0.2 – Integrations`

**Description:**

Allow users to explore how papers are connected to each other through citations — visualized as an interactive force-directed graph.

**Acceptance criteria:**
- Backend endpoint: `GET /papers/{id}/citation-network?depth=2` returns nodes (papers) and edges (cites / cited-by) up to N hops
- Use Semantic Scholar or OpenAlex citation data as the source
- Frontend renders the graph using [D3.js](https://d3js.org/) or [react-force-graph](https://github.com/vasturiano/react-force-graph)
- Clicking a node navigates to that paper's detail page
- Graph is pannable and zoomable
- Cap graph at 100 nodes to prevent performance issues; show a warning if the network is larger
- Works on desktop viewport; mobile is a stretch goal

---

## Issue 9: Custom Prompt Templates

**Labels:** `feature`, `backend`, `frontend`
**Milestone:** `v0.2 – Integrations`

**Description:**

Power users want to define their own prompts for how Footnote summarizes and analyzes papers, rather than using the built-in default prompt.

**Acceptance criteria:**
- Add a "Prompt Templates" section in user settings
- Users can create, name, edit, and delete templates
- Templates support `{{paper_title}}`, `{{abstract}}`, `{{authors}}`, `{{year}}` as interpolation variables
- Users can select a template as their default or choose one per-session from a dropdown in the chat interface
- Templates are stored per-user in the database (not in localStorage)
- Validate template length server-side (max 2000 characters)
- Seed a few built-in read-only templates ("Structured Summary", "Key Contributions", "Critique Mode") as inspiration

---

## Issue 10: Per-Paper Annotation

**Labels:** `feature`, `backend`, `frontend`
**Milestone:** `v0.3 – UX Polish`

**Description:**

Users should be able to attach personal notes and highlights to individual papers — similar to a research notebook layer on top of the paper metadata.

**Acceptance criteria:**
- In the paper detail view, add a collapsible "My Notes" panel
- Users can write free-text notes in a simple rich-text editor (bold, italic, bullet lists minimum)
- Notes are saved automatically (debounced, no explicit save button)
- Users can highlight specific passages from the abstract and attach inline comments
- Notes and highlights are stored in the database associated with the user + paper ID
- Notes are visible in the user's saved-papers list as a badge/indicator
- Export notes alongside paper metadata when using the export feature (Issue #1 and future exports)
- Notes are private by default; sharing is out of scope for this issue
