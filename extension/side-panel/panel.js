"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// API base URL.
// During development:   run `vercel dev` and keep this as http://localhost:3000
// Before production:    replace with your deployed Vercel URL, e.g.:
//                       https://knowledge-collision-extension.vercel.app
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:3000";

// ── Module state ──────────────────────────────────────────────────────────────
let currentContent  = null;   // Raw extracted page content
let extractedData   = null;   // Parsed thesis/assertions from /api/extract-thesis
let articleSaved    = false;  // Guard: don't save the same article twice
let savedArticleId  = null;

// ── DOM references (set after DOMContentLoaded) ───────────────────────────────
let statusEl, thesisSectionEl, thesisTextEl, assertionsListEl, domainTagsEl;
let extractLoaderEl, collideBtnEl, collideLoaderEl, collisionSectionEl;
// Stage 7 — Library view
let viewReadingEl, viewLibraryEl, tabReadingEl, tabLibraryEl;
let libraryLoaderEl, libraryStatusEl, libraryListEl;

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  statusEl          = document.getElementById("status");
  thesisSectionEl   = document.getElementById("thesis-section");
  thesisTextEl      = document.getElementById("thesis-text");
  assertionsListEl  = document.getElementById("assertions-list");
  domainTagsEl      = document.getElementById("domain-tags");
  extractLoaderEl   = document.getElementById("extract-loader");
  collideBtnEl      = document.getElementById("collide-btn");
  collideLoaderEl   = document.getElementById("collide-loader");
  collisionSectionEl  = document.getElementById("collision-section");
  // Stage 7
  viewReadingEl     = document.getElementById("view-reading");
  viewLibraryEl     = document.getElementById("view-library");
  tabReadingEl      = document.getElementById("tab-reading");
  tabLibraryEl      = document.getElementById("tab-library");
  libraryLoaderEl   = document.getElementById("library-loader");
  libraryStatusEl   = document.getElementById("library-status");
  libraryListEl     = document.getElementById("library-list");

  collideBtnEl.addEventListener("click", handleCollide);

  // Tab switching
  tabReadingEl.addEventListener("click", () => switchTab("reading"));
  tabLibraryEl.addEventListener("click", () => switchTab("library"));

  // ── Two-phase content pickup ──────────────────────────────────────────────
  // Phase 1: poll the service worker cache (handles panel-loaded-after-extraction)
  chrome.runtime.sendMessage({ type: "GET_CONTENT" }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.data) {
      processContent(response.data);
    } else {
      setStatus("Click the \u25C6 Episteme icon on a page to analyse it.");
    }
  });

  // Phase 2: listen for live broadcast (handles panel-loaded-before-extraction)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CONTENT_READY") processContent(message.data);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg) {
  statusEl.textContent = msg;
}

function resetUI() {
  thesisSectionEl.style.display   = "none";
  collideBtnEl.style.display      = "none";
  collisionSectionEl.innerHTML    = "";
  collideLoaderEl.style.display   = "none";
  collideBtnEl.disabled           = false;
  articleSaved  = false;
  savedArticleId = null;
  extractedData  = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Extract thesis (independent loading state)
// ─────────────────────────────────────────────────────────────────────────────
async function processContent(content) {
  currentContent = content;
  resetUI();

  extractLoaderEl.style.display = "block";
  setStatus("");

  let data;
  try {
    const response = await fetch(`${API_BASE}/api/extract-thesis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:   content.text,
        title:  content.title,
        author: content.author,
        url:    content.url,
      }),
    });
    data = await response.json();
    if (!response.ok) throw new Error(data.error || "Extraction failed");
  } catch (err) {
    extractLoaderEl.style.display = "none";
    setStatus(`Error: ${err.message}`);
    return;
  }

  extractLoaderEl.style.display = "none";
  extractedData = data;
  renderThesis(data);
}

function renderThesis(data) {
  thesisTextEl.textContent = data.thesis;

  assertionsListEl.innerHTML = "";
  (data.assertions || []).forEach((a) => {
    const li = document.createElement("li");
    li.className = "assertion " + (a.grounded ? "grounded" : "ungrounded");
    li.textContent = a.text;
    assertionsListEl.appendChild(li);
  });

  domainTagsEl.innerHTML = "";
  (data.domain_tags || []).forEach((tag) => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = tag;
    domainTagsEl.appendChild(span);
  });

  thesisSectionEl.style.display = "block";
  // "Check against my library" button only appears after extraction — independent
  collideBtnEl.style.display = "block";
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Save + find collisions (independent loading state)
// ─────────────────────────────────────────────────────────────────────────────
async function handleCollide() {
  if (!extractedData) return;

  collideBtnEl.disabled         = true;
  collideLoaderEl.style.display = "block";
  collisionSectionEl.innerHTML  = "";
  setStatus("");

  try {
    // Save article first (only once per extraction)
    if (!articleSaved) {
      const saveRes = await fetch(`${API_BASE}/api/save-article`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:      currentContent.title,
          url:        currentContent.url,
          author:     currentContent.author,
          thesis:     extractedData.thesis,
          assertions: extractedData.assertions,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Save failed");
      savedArticleId = saveData.article_id;
      articleSaved   = true;
    }

    // Then find collisions
    const collideRes = await fetch(`${API_BASE}/api/find-collisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ article_id: savedArticleId }),
    });
    const collideData = await collideRes.json();
    if (!collideRes.ok) throw new Error(collideData.error || "Collision search failed");

    const relationships = Array.isArray(collideData)
      ? collideData
      : (collideData.relationships || []);

    collideLoaderEl.style.display = "none";
    renderCollisions(relationships);
  } catch (err) {
    collideLoaderEl.style.display = "none";
    setStatus(`Error: ${err.message}`);
    collideBtnEl.disabled = false;
  }
}

function renderCollisions(relationships) {
  const nonNone = relationships.filter((r) => r.relationship !== "NONE");

  if (nonNone.length === 0) {
    collisionSectionEl.innerHTML =
      '<p class="empty">No significant relationships found in your library yet. Save more articles to build your knowledge graph.</p>';
    return;
  }

  nonNone.forEach((rel) => {
    const card = document.createElement("div");
    card.className = `collision-card rel-${rel.relationship.toLowerCase()}`;

    const badge = `<span class="badge badge-${rel.relationship.toLowerCase()}">${rel.relationship}</span>`;
    const warning = rel.citation_valid === false
      ? '<span class="citation-warning">&#9888; Citation unverified</span>'
      : "";

    card.innerHTML = `
      ${badge}${warning}
      <p class="rationale">${rel.rationale || ""}</p>
      <div class="assertion-pair">
        <div class="cite-block">
          <span class="cite-label">This article</span>
          <span class="cite-text">${rel.cited_assertion_new || ""}</span>
        </div>
        <div class="cite-block">
          <span class="cite-label">Library article</span>
          <span class="cite-text">${rel.cited_assertion_historical || ""}</span>
        </div>
      </div>
    `;
    collisionSectionEl.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 7 — Tab switcher + Library view
// ─────────────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  const isLibrary = tab === "library";

  viewReadingEl.style.display = isLibrary ? "none" : "block";
  viewLibraryEl.style.display = isLibrary ? "block" : "none";

  tabReadingEl.classList.toggle("active", !isLibrary);
  tabReadingEl.setAttribute("aria-selected", String(!isLibrary));
  tabLibraryEl.classList.toggle("active", isLibrary);
  tabLibraryEl.setAttribute("aria-selected", String(isLibrary));

  if (isLibrary) loadLibrary();
}

async function loadLibrary() {
  libraryLoaderEl.style.display = "block";
  libraryListEl.innerHTML = "";
  libraryStatusEl.textContent = "";

  try {
    const res = await fetch(`${API_BASE}/api/library`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load library");

    libraryLoaderEl.style.display = "none";
    renderLibrary(data);
  } catch (err) {
    libraryLoaderEl.style.display = "none";
    libraryStatusEl.textContent = `Error: ${err.message}`;
  }
}

function renderLibrary(articles) {
  if (!articles || articles.length === 0) {
    libraryListEl.innerHTML = '<p class="empty">Your library is empty. Analyse articles and click "Check against my library" to save them.</p>';
    return;
  }

  articles.forEach((article) => {
    const card = document.createElement("div");
    card.className = "library-card";

    // Edges badges
    const edgeBadges = (article.edges || [])
      .map((edge) => {
        const rel = edge.relationship.toLowerCase();
        return `<span class="badge badge-${rel}" title="${edge.direction === 'outgoing' ? 'vs' : 'from'}: ${edge.peer_title || 'unknown'}">${edge.relationship}</span>`;
      })
      .join("");

    const edgesHtml = article.edges && article.edges.length > 0
      ? `<div class="library-card-edges">${edgeBadges}</div>`
      : `<div class="library-card-edges"><span class="no-edges">No connections yet</span></div>`;

    card.innerHTML = `
      <div class="library-card-title">${article.title || "Untitled"}</div>
      <div class="library-card-thesis">${article.thesis || ""}</div>
      ${edgesHtml}
    `;

    libraryListEl.appendChild(card);
  });
}
