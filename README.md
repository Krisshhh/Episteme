# Episteme - an AI-powered Knowledge Collision Extension

> A Chrome extension that reads any article, extracts its thesis and supporting assertions using Gemini, embeds them into a vector database, and surfaces semantic relationships (SUPPORTS / CONTRADICTS / EXTENDS) with every article you've ever read.

---

## Table of Contents

1. [What Was Built](#what-was-built)
2. [Repository Structure](#repository-structure)
3. [Tech Stack](#tech-stack)
4. [Architecture & Data Flow](#architecture--data-flow)
5. [Database Schema](#database-schema)
6. [API Reference](#api-reference)
7. [Extension Architecture](#extension-architecture)
8. [Environment Variables](#environment-variables)
9. [Running Locally](#running-locally)
10. [Stages Completed](#stages-completed)
11. [Stage 8 — What Remains](#stage-8--what-remains)
12. [Known Gaps & Technical Debt](#known-gaps--technical-debt)

---

## What Was Built

Episteme is a full-stack Chrome extension + Vercel serverless backend that does the following:

1. **Reads** any webpage using Mozilla Readability (same engine as Firefox Reader View).
2. **Extracts** the article's central thesis, up to 5 supporting assertions, and domain tags — using Gemini (`gemini-flash-latest`).
3. **Grounds** each assertion by verifying that a verbatim source quote exists in the original article text.
4. **Saves** the article to Supabase with a `gemini-embedding-001` vector embedding (768 dimensions) for semantic search.
5. **Finds collisions** — queries the nearest 3 articles in the vector database and sends them to Gemini to classify: does the new article SUPPORT, CONTRADICT, or EXTEND each historical article?
6. **Validates citations** — checks that the assertions Gemini cited actually exist in the articles (string-similarity threshold 0.75).
7. **Stores edges** — writes validated non-NONE relationships into an `edges` table.
8. **Shows results** in a Chrome Side Panel with two tabs: Reading (thesis + collision results) and Library (all saved articles with their relationship badges).
9. **Context menu** — right-click any selected text → "Synthesize selection with Episteme" → runs the same flow on just the selected text.

---

## Repository Structure

```
knowledge-collision-extension/
│
├── api/                          # Vercel serverless functions (Node.js only)
│   ├── extract-thesis.js         # POST — Gemini thesis + assertion extraction
│   ├── save-article.js           # POST — embed + save article to Supabase
│   ├── find-collisions.js        # POST — pgvector search + Gemini relationship analysis
│   └── library.js                # GET  — fetch all articles + edges for Library view
│
├── lib/                          # Shared server-side modules
│   ├── gemini.js                 # callGemini() + getEmbedding() — all Gemini API calls
│   ├── grounding.js              # validateGrounding() — checks source_quote in article text
│   ├── prompts.js                # THESIS_EXTRACTION_PROMPT + COLLISION_ANALYSIS_PROMPT
│   ├── supabase.js               # Supabase client (service_role, no RLS, no session)
│   └── cors.js                   # applyCors() — CORS headers for all API routes
│
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json             # MV3 manifest — permissions, service worker, side panel
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   ├── background/
│   │   └── service-worker.js     # Action click → inject scripts; message relay; context menu
│   ├── content-scripts/
│   │   ├── Readability.js        # Mozilla Readability (copied from npm, browser-ready)
│   │   └── extract-content.js   # Injected on demand — clones doc, runs Readability, sends message
│   ├── side-panel/
│   │   ├── panel.html            # Two-tab layout: Reading + Library
│   │   ├── panel.js              # All side panel logic — fetch, render, tab switching
│   │   └── panel.css             # Dark theme — purple/violet brand, colour-coded badges
│   └── context-menu/
│       └── synthesize-selection.js  # Context menu registration + click handler logic
│
├── scripts/
│   └── test-agent1.js            # Standalone Stage 1 test script (no server needed)
│
├── .env.local                    # Local secrets — NEVER commit this
├── vercel.json                   # Vercel config (function timeout)
├── package.json                  # Node deps + scripts
└── AGENT_BUILD_SPEC.md           # Original build specification (source of truth)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Extension** | Chrome MV3 — Side Panel API, scripting, contextMenus |
| **Content parsing** | `@mozilla/readability` — same as Firefox Reader View |
| **Backend runtime** | Node.js 18+ on Vercel Serverless Functions |
| **LLM** | Google Gemini — `gemini-flash-latest` for text, `gemini-embedding-001` for embeddings |
| **Embedding dims** | 768 (Matryoshka truncation via `outputDimensionality: 768`) |
| **Database** | Supabase (PostgreSQL + pgvector extension) |
| **Vector search** | `ivfflat` index, cosine distance (`<->` operator) |
| **Citation validation** | `string-similarity` npm package (threshold 0.75) |

---

## Architecture & Data Flow

### Flow 1 — Full Article Analysis (Extension Icon Click)

```
User clicks ◆ Episteme icon
        │
        ▼
service-worker.js
  ├── chrome.sidePanel.open({ tabId })
  └── chrome.scripting.executeScript([Readability.js, extract-content.js])
        │
        ▼ (injected into page)
extract-content.js
  └── new Readability(document.cloneNode(true)).parse()
  └── chrome.runtime.sendMessage({ type: 'CONTENT_EXTRACTED', data: { text, title, author, url } })
        │
        ▼
service-worker.js
  ├── cachedContent = data
  └── chrome.runtime.sendMessage({ type: 'CONTENT_READY', data })
        │
        ▼
panel.js (side panel)
  └── processContent(data)
        │
        ▼
POST /api/extract-thesis
  ├── THESIS_EXTRACTION_PROMPT(text) → callGemini() → raw JSON
  ├── parse JSON → { thesis, assertions, domain_tags }
  ├── validateGrounding(assertions, text) → grounded: true/false per assertion
  └── return { thesis, assertions, domain_tags }
        │
        ▼
panel.js renders:
  ├── Thesis block
  ├── Assertions list (green = grounded, grey = ungrounded)
  └── Domain tags
  └── "Check against my library" button appears
```

### Flow 2 — Save + Collision Search (Button Click)

```
User clicks "Check against my library"
        │
        ▼
POST /api/save-article
  ├── getEmbedding(thesis) → gemini-embedding-001 → vector[768]
  ├── INSERT INTO articles (title, url, author, thesis, embedding)
  └── INSERT INTO assertions (article_id, text, source_quote, grounded) × N
  └── return { article_id }
        │
        ▼
POST /api/find-collisions
  ├── SELECT article + embedding FROM articles WHERE id = article_id
  ├── SELECT assertions FROM assertions WHERE article_id = article_id
  ├── supabase.rpc('match_articles', { query_embedding, exclude_id, match_count: 3 })
  │     └── SQL: ORDER BY embedding <-> query_embedding LIMIT 3
  ├── SELECT assertions for each retrieved article
  ├── COLLISION_ANALYSIS_PROMPT(thesis, assertions, retrievedArticles) → callGemini()
  ├── parse JSON array → [{ compared_article_id, relationship, cited_assertion_new,
  │                         cited_assertion_historical, rationale }]
  ├── validate each citation via string-similarity (threshold 0.75)
  ├── INSERT INTO edges (article_a_id, article_b_id, relationship, rationale)
  │     only for relationship != 'NONE' AND citation_valid == true
  └── return full array (including citation_valid flags)
        │
        ▼
panel.js renders collision cards:
  ├── SUPPORTS  → green left border + green badge
  ├── CONTRADICTS → red left border + red badge
  ├── EXTENDS   → blue left border + blue badge
  └── ⚠ Citation unverified (if citation_valid: false)
```

### Flow 3 — Context Menu (Right-click selected text)

```
User selects text → right-click → "Synthesize selection with Episteme"
        │
        ▼
service-worker.js (chrome.contextMenus.onClicked)
  ├── cachedContent = { text: info.selectionText, title, url, author: null }
  ├── chrome.sidePanel.open({ tabId })
  └── chrome.runtime.sendMessage({ type: 'CONTENT_READY', data })
        │
        ▼
panel.js (same processContent() as Flow 1 — no code duplication)
  └── only the selected text is sent to /api/extract-thesis, not the full page
```

### Flow 4 — Library View (Tab Switch)

```
User clicks "Library" tab
        │
        ▼
GET /api/library
  ├── SELECT id, title, author, url, thesis, created_at FROM articles ORDER BY created_at DESC
  ├── SELECT id, article_a_id, article_b_id, relationship, rationale FROM edges
  ├── Join edges onto each article (both directions — a_id and b_id)
  ├── Resolve peer article titles from in-memory map
  └── return [{ ...article, edges: [{ relationship, peer_title, direction }] }]
        │
        ▼
panel.js renderLibrary()
  └── One card per article: title, thesis preview (2-line clamp), relationship badges
```

---

## Database Schema

Tables live in Supabase (PostgreSQL + pgvector). Applied manually via SQL editor.

```sql
-- Articles
CREATE TABLE articles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT,
  url         TEXT,
  author      TEXT,
  thesis      TEXT NOT NULL,
  embedding   vector(768),           -- gemini-embedding-001 at outputDimensionality:768
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Assertions (supporting claims extracted from each article)
CREATE TABLE assertions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   UUID REFERENCES articles(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,         -- assertion restated in model's words
  source_quote TEXT,                  -- verbatim quote from original article
  grounded     BOOLEAN DEFAULT FALSE, -- verified by validateGrounding()
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Edges (relationships between articles)
CREATE TABLE edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_a_id      UUID REFERENCES articles(id) ON DELETE CASCADE,
  article_b_id      UUID REFERENCES articles(id) ON DELETE CASCADE,
  relationship      TEXT NOT NULL,    -- SUPPORTS | CONTRADICTS | EXTENDS
  cited_assertion_a UUID REFERENCES assertions(id),
  cited_assertion_b UUID REFERENCES assertions(id),
  rationale         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ivfflat vector index for cosine distance search
CREATE INDEX ON articles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Postgres function called by find-collisions via supabase.rpc()
CREATE OR REPLACE FUNCTION match_articles(
  query_embedding vector(768),
  exclude_id      UUID,
  match_count     INT DEFAULT 3
)
RETURNS TABLE (id UUID, title TEXT, author TEXT, url TEXT, thesis TEXT)
LANGUAGE sql STABLE AS $$
  SELECT id, title, author, url, thesis
  FROM articles
  WHERE id != exclude_id AND embedding IS NOT NULL
  ORDER BY embedding <-> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_articles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON articles, assertions, edges TO service_role;
```

> **Note on embedding dimensions:** `gemini-embedding-001` natively generates 3072-dim vectors. We truncate to 768 via `outputDimensionality: 768` (Matryoshka truncation) in `lib/gemini.js` to stay within `ivfflat`'s 2000-dim limit.

---

## API Reference

All routes live under `/api/` and are Vercel serverless functions. All return JSON. All have CORS headers (`Access-Control-Allow-Origin: *`).

### `POST /api/extract-thesis`

Extracts thesis, assertions, and domain tags from article text.

**Request body:**
```json
{
  "text": "full article text (required)",
  "title": "optional",
  "author": "optional",
  "url": "optional"
}
```

**Response `200`:**
```json
{
  "thesis": "One declarative sentence",
  "assertions": [
    { "text": "assertion", "source_quote": "verbatim from article", "grounded": true }
  ],
  "domain_tags": ["machine-learning", "nlp"]
}
```

---

### `POST /api/save-article`

Embeds the thesis and saves the article + assertions to Supabase. Idempotent in spirit — does not deduplicate by URL.

**Request body:**
```json
{
  "title": "Article title",
  "url": "https://...",
  "author": "Author name or null",
  "thesis": "The central thesis",
  "assertions": [
    { "text": "...", "source_quote": "...", "grounded": true }
  ]
}
```

**Response `200`:**
```json
{ "article_id": "uuid" }
```

**Error handling:** If assertions insert fails, the article row is deleted (compensating transaction — not a true DB transaction).

---

### `POST /api/find-collisions`

Finds the 3 nearest articles via cosine distance, asks Gemini to classify relationships, validates citations, and writes edges.

**Request body:**
```json
{ "article_id": "uuid" }
```

**Response `200`:**
```json
[
  {
    "compared_article_id": "uuid",
    "relationship": "EXTENDS",
    "cited_assertion_new": "...",
    "cited_assertion_historical": "...",
    "rationale": "Two sentence explanation.",
    "citation_valid": true
  }
]
```

> If edge insert fails (non-fatal), returns `{ relationships: [...], warning: "Edge insert failed: ..." }`.

---

### `GET /api/library`

Returns all saved articles with their edges pre-joined (peer titles resolved). No request body.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "title": "Article title",
    "author": "...",
    "url": "https://...",
    "thesis": "...",
    "created_at": "2026-07-18T...",
    "edges": [
      {
        "id": "uuid",
        "relationship": "EXTENDS",
        "rationale": "...",
        "peer_id": "uuid",
        "peer_title": "Title of related article",
        "direction": "outgoing"
      }
    ]
  }
]
```

---

## Extension Architecture

### Manifest V3 Permissions

| Permission | Why it's needed |
|---|---|
| `sidePanel` | Open and control the Chrome Side Panel |
| `activeTab` | Script injection rights on the tab the user is on when they click the icon |
| `scripting` | `chrome.scripting.executeScript()` to inject Readability + extract-content |
| `storage` | `chrome.storage.session` (available, not currently used — reserved) |
| `contextMenus` | Right-click "Synthesize selection" menu item |

### File Responsibilities

#### `background/service-worker.js`
The extension's single background script. Responsibilities:
- Listens for action button click → opens side panel → injects content scripts
- Caches `cachedContent` (in-memory, module scope)
- Routes messages: `CONTENT_EXTRACTED` → cache + broadcast; `GET_CONTENT` → respond with cache
- Registers and handles the context menu item (inlined, not imported)

> ⚠️ **Known risk:** `cachedContent` is lost if Chrome terminates the service worker (idle >30s). User must click the icon again. Fix: use `chrome.storage.session`.

#### `content-scripts/extract-content.js`
Injected **on demand** (not on every page load). Runs Readability on a cloned document, sends `{ text, title, author, url }` to the service worker. Never runs unless the user explicitly triggers extraction.

#### `content-scripts/Readability.js`
Mozilla's Readability library, copied directly from `node_modules/@mozilla/readability/Readability.js`. No bundler needed — it's a self-contained browser-compatible file. Injected before `extract-content.js` so `Readability` is available as a global.

#### `side-panel/panel.js`
All UI logic lives here. Key design decisions:
- **Two independent loading states:** `extract-loader` (thesis) and `collide-loader` (collision search) are fully separate DOM elements and async flows.
- **Collide button** only appears after thesis is rendered — never before.
- **Save guard:** `articleSaved` flag prevents double-saving the same extraction.
- **Dual content pickup:** polls `GET_CONTENT` on load AND listens for `CONTENT_READY` broadcast — handles both timing cases (panel opens before or after extraction completes).
- **`API_BASE`** constant at the top of the file — must be updated to the Vercel deployment URL before production use.

#### `context-menu/synthesize-selection.js`
Contains the context menu registration logic as authored per spec. The code is **inlined into service-worker.js** (not imported via `importScripts`) because Chrome MV3 resolves `importScripts` paths relative to the service worker's own directory, causing path resolution failures when the service worker lives in a subdirectory. This file is the source of truth for that logic.

---

## Environment Variables

All secrets live in `.env.local` (never committed). For Vercel deployment, add them via the Vercel dashboard or CLI.

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) → API Keys |
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → `service_role` JWT |

> **Important:** Use the `service_role` key (not the `anon` key) for `SUPABASE_SERVICE_ROLE_KEY`. The service role bypasses Row Level Security.

---

## Running Locally

### Prerequisites
- Node.js 18+
- Vercel CLI (`npm i -g vercel`)
- A Supabase project with the schema applied (see [Database Schema](#database-schema))
- Gemini API key

### Steps

```powershell
# 1. Install dependencies
cd d:\Episteme\knowledge-collision-extension
npm install

# 2. Set up environment variables
# Option A: manually create .env.local with your keys
# Option B: after running `vercel link`, run:
vercel env pull .env.local --environment=development --yes

# 3. Start the local API server
vercel dev

# 4. Load the Chrome extension
# - Open chrome://extensions
# - Enable Developer mode
# - Click "Load unpacked"
# - Select: d:\Episteme\knowledge-collision-extension\extension\
```

> **After any change to extension files**, go to `chrome://extensions` → click **Update** on Episteme.
> **After any change to `service-worker.js`**, remove and re-add the extension — Chrome caches service workers aggressively.

### Testing the API directly (PowerShell)

```powershell
# Extract thesis
Invoke-RestMethod -Uri "http://localhost:3000/api/extract-thesis" `
  -Method POST -ContentType "application/json" `
  -Body '{"text":"The Transformer model replaces recurrence with self-attention, enabling parallelisation and state-of-the-art sequence modelling."}'

# Get library
Invoke-RestMethod -Uri "http://localhost:3000/api/library" -Method GET
```

---

## Stages Completed

| Stage | What was built | Status |
|---|---|---|
| **Stage 1** | `scripts/test-agent1.js` — standalone Gemini extraction + sliding-window grounding | ✅ Complete |
| **Stage 2** | `api/extract-thesis.js`, `lib/gemini.js`, `lib/grounding.js`, `lib/prompts.js`, `vercel.json` | ✅ Complete |
| **Stage 3** | `api/save-article.js`, `lib/supabase.js` — embed + save to Supabase | ✅ Complete |
| **Stage 4** | `api/find-collisions.js` — pgvector search + Gemini relationship analysis + edge writing | ✅ Complete |
| **Stage 5** | Chrome extension shell — manifest, service worker, Readability injection, side panel (Reading view) | ✅ Complete |
| **Stage 6** | Context menu — "Synthesize selection with Episteme" | ✅ Complete |
| **Stage 7** | `api/library.js`, Library tab in side panel with article cards + relationship badges | ✅ Complete |
| **Stage 8** | Deployment readiness check (no new code — checklist + debug audit) | ⬜ Not started |

---

## Stage 8 — What Remains

Per `AGENT_BUILD_SPEC.md`, Stage 8 is **not a coding stage**. It requires:

1. **Manual verification checklist** before demoing:
   - Wake Supabase (free tier idles after inactivity — run a simple query first)
   - Check Gemini quota (`gemini-flash-latest` on the current API key)
   - Cold end-to-end run: open a fresh browser profile, load extension, analyse an article, check against library
   - Confirm `API_BASE` in `extension/side-panel/panel.js` is updated to the Vercel deployment URL

2. **Debug audit** — scan all files built in Stages 1–7 for `console.log` / debug statements, list them so the developer can decide whether to remove them before a demo.

3. **No file deletions or modifications** — Stage 8 is output-only.

---

## Known Gaps & Technical Debt

| Issue | Severity | Location | Fix |
|---|---|---|---|
| `cachedContent` lost on service worker restart | Medium | `service-worker.js` | Use `chrome.storage.session` |
| No URL deduplication in save-article | Low | `api/save-article.js` | Check by URL before inserting |
| Manual rollback (not DB transaction) in save-article | Medium | `api/save-article.js` | Use `supabase.rpc()` with a Postgres transaction |
| `API_BASE` hardcoded to `localhost:3000` | High (for production) | `extension/side-panel/panel.js` line 9 | Replace with Vercel deployment URL |
| `match_articles` Postgres function not tracked in repo | Medium | Supabase only | Add to a `db/functions.sql` file |
| `ivfflat` index may not use probe lists optimally | Low | Supabase | Run `SET ivfflat.probes = 10` before queries |
| Graph visualisation not built | By design | — | Explicitly deferred per spec |
| No authentication on API routes | By design | `api/*.js` | Out of scope per spec |
