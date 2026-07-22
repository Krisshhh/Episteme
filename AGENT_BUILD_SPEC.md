# AGENT_BUILD_SPEC.md — named "Episteme"

You are an AI coding assistant building this project stage by stage. This document is your only source of truth. Do not infer requirements, do not add features not listed here, do not skip ahead.

## Rules you must follow for every stage

1. Build only the stage you are currently told to build. If asked to "start," build Stage 1 only, then stop and output the checkpoint report defined below. Do not continue to Stage 2 unless explicitly told "proceed to Stage 2."
2. Never create a file outside the directory structure in Section 2. If you believe a new file is needed, state that in your output and ask before creating it.
3. Runtime is locked: Node.js for all `/api` functions and `lib/` files. Do not use Python anywhere in this repo.
4. Never inline a prompt string inside a route file. All LLM prompts live in `lib/prompts.js` as named exports.
5. Never read `process.env` directly outside `lib/gemini.js` and `lib/supabase.js`.
6. At the end of every stage, output a checkpoint report in exactly the format specified in Section 3. Do not skip this. Do not summarize it differently.
7. If a stage's acceptance test would fail based on your own reasoning, say so explicitly in the checkpoint report rather than presenting the stage as complete.
8. Do not modify files created in a previous stage unless the current stage's instructions explicitly say to.
9. Do not add error handling, retries, logging, or "nice to have" improvements beyond what the stage specifies. Extra unrequested code is a defect, not a bonus, it makes the diff harder to review.

---

## Section 1 — Fixed technical decisions (do not re-decide these)

- Extension: Chrome Manifest V3, Side Panel API. No New Tab override, no popup-only UI.
- Content extraction: `@mozilla/readability`, runs in a content script, client-side only.
- Backend: Vercel serverless functions, Node.js runtime.
- LLM: Google Gemini API, model `gemini-2.0-flash`.
- Embeddings: Gemini `text-embedding-004`, 768 dimensions.
- Database: Supabase, Postgres + pgvector extension. No other database.
- Fuzzy matching: `string-similarity` npm package (Node only, per Rule 3).
- No Docker. No locally-run database. No local server process beyond `vercel dev`.

---

## Section 2 — Directory structure (create exactly this, nothing else)

```
knowledge-collision-extension/
├── README.md
├── AGENT_BUILD_SPEC.md
├── .env.local
├── .gitignore
├── extension/
│   ├── manifest.json
│   ├── background/service-worker.js
│   ├── content-scripts/extract-content.js
│   ├── side-panel/panel.html
│   ├── side-panel/panel.js
│   ├── side-panel/panel.css
│   ├── context-menu/synthesize-selection.js
│   └── icons/icon16.png, icon48.png, icon128.png
├── api/
│   ├── extract-thesis.js
│   ├── save-article.js
│   ├── find-collisions.js
│   └── library.js
├── lib/
│   ├── gemini.js
│   ├── supabase.js
│   ├── grounding.js
│   └── prompts.js
├── db/schema.sql
├── scripts/test-agent1.js
├── vercel.json
└── package.json
```

---

## Section 3 — Checkpoint report format (output this after every stage, no exceptions)

```
STAGE [N] COMPLETE

Files created/modified:
- [path] — [one line, what it does]

Assumptions made (if any):
- [state explicitly, or write "none"]

Acceptance criteria status:
- [ ] [criterion from the stage] — PASS / FAIL / UNVERIFIED (explain UNVERIFIED, e.g. "requires human to run against real article")

Known gaps or risks introduced by this stage:
- [state explicitly, or write "none"]

STOP. Awaiting human verification before proceeding to Stage [N+1].
```

---

## Section 4 — Environment variables

Declare these in `.env.local`, values supplied by the human, never generate placeholder values yourself:

```
GEMINI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Section 5 — Database schema

Write this exact SQL to `db/schema.sql`. Do not execute it yourself, output it for the human to run in the Supabase SQL editor.

```sql
create extension if not exists vector;

create table articles (
  id uuid primary key default gen_random_uuid(),
  url text,
  title text,
  author text,
  thesis text not null,
  embedding vector(768),
  created_at timestamptz default now()
);

create table assertions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) on delete cascade,
  text text not null,
  source_quote text not null,
  grounded boolean not null default false
);

create table edges (
  id uuid primary key default gen_random_uuid(),
  article_a_id uuid references articles(id) on delete cascade,
  article_b_id uuid references articles(id) on delete cascade,
  relationship text check (relationship in ('SUPPORTS', 'CONTRADICTS', 'EXTENDS', 'NONE')),
  cited_assertion_a uuid references assertions(id),
  cited_assertion_b uuid references assertions(id),
  rationale text,
  created_at timestamptz default now()
);

create index on articles using ivfflat (embedding vector_cosine_ops);
```

---

## STAGE 1 — Standalone thesis extraction script

Build `scripts/test-agent1.js` only. No other files.

Requirements:
- Accepts a hardcoded article text string (define one ~500 word sample inline at the top of the file, taken from any real technical article, mark it clearly as `const SAMPLE_TEXT`).
- Calls Gemini `gemini-2.0-flash` with a system prompt (write this prompt directly in this script for now, do not import from `lib/prompts.js` yet, that happens in Stage 2) instructing the model to return strict JSON only, no markdown fences, no preamble, matching this shape:

```json
{
  "thesis": "string",
  "assertions": [
    { "text": "string", "source_quote": "string" }
  ],
  "domain_tags": ["string"]
}
```

- After receiving the response, parse it as JSON. If parsing fails, log the raw response and exit with an error, do not attempt to auto-repair malformed JSON.
- For each assertion, run `string-similarity` comparison between `source_quote` and `SAMPLE_TEXT`, using a sliding window or substring search. Mark `grounded: true` if similarity exceeds 0.9, else `grounded: false`.
- Print the final JSON with `grounded` fields added, to stdout.

Acceptance criteria:
- [ ] Script runs via `node scripts/test-agent1.js` and prints valid JSON.
- [ ] At least one assertion's `source_quote` is verified as present in `SAMPLE_TEXT` — UNVERIFIED status is acceptable here since it requires a human to visually confirm quote quality, not just that the field exists.
- [ ] Script does not crash on a malformed Gemini response, it exits cleanly with a logged error instead.

Output the Section 3 checkpoint report. Stop.

---

## STAGE 2 — `/api/extract-thesis.js` as a deployed Vercel function

Build only: `lib/gemini.js`, `lib/grounding.js`, `lib/prompts.js`, `api/extract-thesis.js`, `vercel.json`.

Requirements:
- `lib/gemini.js`: exports a function `callGemini(prompt)` that reads `GEMINI_API_KEY` from `process.env` and returns the raw text response. This is the only file (besides `lib/supabase.js`, built in Stage 3) allowed to touch `process.env`.
- `lib/prompts.js`: exports `THESIS_EXTRACTION_PROMPT` as a template function taking `articleText` and returning the full prompt string, using the same schema as Stage 1.
- `lib/grounding.js`: exports `validateGrounding(assertions, sourceText)`, moved out of the Stage 1 script, same logic (string-similarity, 0.9 threshold).
- `api/extract-thesis.js`: Vercel serverless function, `POST` only. Accepts JSON body `{ text, title, url, author }`. Calls `lib/gemini.js` with the prompt from `lib/prompts.js`, parses the response, runs `validateGrounding`, returns the validated JSON with HTTP 200. On any failure (missing `text` field, Gemini error, JSON parse failure), return an appropriate 4xx or 5xx with a JSON error body `{ error: "message" }`. Do not add retry logic, this stage is not asking for that.
- `vercel.json`: set function timeout as high as the free tier allows for this function specifically.

Acceptance criteria:
- [ ] Function deploys to Vercel without build errors.
- [ ] A POST request with a real article's `text` field returns HTTP 200 with valid JSON matching the schema.
- [ ] A POST request with an empty or missing `text` field returns a 4xx with an `error` field, not a 500 or a crash.
- [ ] Response time is under the configured timeout — UNVERIFIED is acceptable, flag it, human will test with real load.

Output the Section 3 checkpoint report. Stop.

---

## STAGE 3 — Supabase write path

Build only: `lib/supabase.js`, `api/save-article.js`. Do not modify `api/extract-thesis.js`.

Requirements:
- `lib/supabase.js`: exports an initialized Supabase client using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env`.
- `lib/gemini.js`: add a second exported function `getEmbedding(text)` using `text-embedding-004`, returning a 768-length float array. Do not modify the existing `callGemini` export.
- `api/save-article.js`: `POST` only. Accepts `{ title, url, author, thesis, assertions }` (the validated output of `extract-thesis`). Steps:
  1. Call `getEmbedding(thesis)`.
  2. Insert into `articles` table.
  3. Insert each assertion into `assertions` table with the returned `article_id`.
  4. If step 3 fails after step 2 succeeded, delete the article row inserted in step 2 before returning the error. State explicitly in your checkpoint report that this is manual rollback, not a database transaction, and flag it as a known gap.
- Return the created `article_id` on success.

Acceptance criteria:
- [ ] A POST with valid thesis + assertions data creates rows in both `articles` and `assertions` tables — UNVERIFIED, human must check Supabase table editor directly.
- [ ] The `embedding` column is populated with a 768-length array, not null.
- [ ] Manually forcing an assertions insert failure (note this as a suggested manual test for the human, do not build a test harness for it) results in the article row being deleted, not orphaned.

Output the Section 3 checkpoint report. Stop.

---

## STAGE 4 — `/api/find-collisions.js`

Build only: `api/find-collisions.js`. Add `COLLISION_ANALYSIS_PROMPT` to `lib/prompts.js`, do not modify `THESIS_EXTRACTION_PROMPT`.

Requirements:
- `POST` only. Accepts `{ article_id }`.
- Fetch the article's embedding and assertions from Supabase.
- Query `articles` table via pgvector cosine distance (`<->` operator) for the top 3 nearest articles, excluding `article_id` itself. Fetch their assertions too.
- Build `COLLISION_ANALYSIS_PROMPT(newThesis, newAssertions, retrievedArticles)`, instructing Gemini to return an array of up to 3 objects:

```json
[
  {
    "compared_article_id": "uuid",
    "relationship": "SUPPORTS | CONTRADICTS | EXTENDS | NONE",
    "cited_assertion_new": "string, must match an actual assertion text from the new article",
    "cited_assertion_historical": "string, must match an actual assertion text from the retrieved article",
    "rationale": "max 2 sentences"
  }
]
```

- After parsing the response, validate that `cited_assertion_new` and `cited_assertion_historical` each exactly or near-exactly match an assertion actually present in the corresponding article's assertion list. If a citation doesn't match anything real, mark that object `"citation_valid": false` in the response rather than silently passing it through.
- Insert validated relationships (excluding NONE) into the `edges` table.
- Return the full relationship array (including any marked `citation_valid: false`, do not hide them from the response).

Acceptance criteria:
- [ ] Function returns a relationship array for an article with at least 2 other articles already in the DB — UNVERIFIED, human must seed test data first.
- [ ] `citation_valid: false` is correctly triggered when tested against a deliberately fabricated citation — UNVERIFIED, flag that human must manually construct this test case, do not attempt to auto-generate a fabricated example yourself.
- [ ] Edges are written to the `edges` table only for non-NONE relationships.

Output the Section 3 checkpoint report. Stop.

---

## STAGE 5 — Extension shell

Build only the `extension/` directory contents.

Requirements:
- `manifest.json`: Manifest V3, permissions: `sidePanel`, `activeTab`, `scripting`. No `tabs`, no `<all_urls>` host permission unless strictly required, justify in checkpoint report if you add it.
- `content-scripts/extract-content.js`: injected on demand (not on every page load), runs Readability against `document`, extracts `{ text, title, author, url }`, sends via `chrome.runtime.sendMessage`.
- `background/service-worker.js`: listens for the extracted content message, does NOT call the API itself, forwards to the side panel via `chrome.runtime.sendMessage` or shared state. Side panel owns the API calls.
- `side-panel/panel.js`: on receiving content, calls `POST /api/extract-thesis`, renders thesis + assertions as soon as the response arrives. Renders a separate "Check against my library" button that only on click calls `POST /api/save-article` (if not already saved) then `POST /api/find-collisions`, rendering results as they arrive. Two independent loading states, not one shared spinner.
- `side-panel/panel.html` / `panel.css`: minimal, functional, no design system work in this stage.

Acceptance criteria:
- [ ] Extension loads via `chrome://extensions` "load unpacked" without manifest errors — UNVERIFIED, human must load it.
- [ ] Clicking the extension icon on a real webpage triggers extraction — UNVERIFIED, human must test on a live page.
- [ ] Thesis renders independently of and before the collision check completes.

Output the Section 3 checkpoint report. Stop.

---

## STAGE 6 — Context menu "Synthesize Selection"

Build only: `extension/context-menu/synthesize-selection.js`, and the minimal `manifest.json` addition for `contextMenus` permission plus the menu registration. Do not modify `extract-content.js`.

Requirements:
- Register a context menu item visible only when text is selected.
- On click, send only the selected text (via `info.selectionText`) through the same `extract-thesis` flow as Stage 5, reusing `panel.js` rendering logic, not duplicating it.

Acceptance criteria:
- [ ] Context menu item appears only on text selection, not on every right-click — UNVERIFIED, human must test.
- [ ] Payload sent to `/api/extract-thesis` contains only the selected text, not the full page (state this must be confirmed via Vercel function logs by the human).

Output the Section 3 checkpoint report. Stop.

---

## STAGE 7 — Library view

Build only: `api/library.js`, and additions to `side-panel/panel.html` / `panel.js` for a second tab/view. Do not modify `extract-thesis.js`, `save-article.js`, or `find-collisions.js`.

Requirements:
- `api/library.js`: `GET` only. Returns all articles with their associated edges, joined in a reasonable shape for the frontend to render without further processing.
- Side panel: add a tab switcher between "Reading" (Stage 5/6 view) and "Library" (this stage). Library view lists articles with colored relationship badges per edge. Do not build a graph visualization in this stage, that is explicitly out of scope, flag it as a possible future addition only if asked.

Acceptance criteria:
- [ ] `GET /api/library` returns previously saved articles and their edges — UNVERIFIED, human must confirm against known seeded data.
- [ ] Library tab renders without errors when the list is empty (zero articles saved).

Output the Section 3 checkpoint report. Stop.

---

## STAGE 8 — Deployment readiness check

Do not write new application code in this stage. Output only:
- A checklist of manual verification steps the human must perform before demoing (waking Supabase, checking Gemini quota, testing a cold end-to-end run).
- A list of any `console.log` or debug statements left in the codebase across all files built in Stages 1-7, so the human can decide whether to remove them.
- Do not delete or modify any file in this stage without being asked.

Output the Section 3 checkpoint report. Stop.
