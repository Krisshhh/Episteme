"use strict";

// In-memory cache for the most recently extracted page content.
let cachedContent = null;

// ── Action button click: open side panel + inject content scripts ─────────────
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "content-scripts/Readability.js",
        "content-scripts/extract-content.js",
      ],
    });
  } catch (err) {
    // Blocked pages (chrome://, PDF, web store) — panel stays in idle state.
  }
});

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_CONTENT") {
    sendResponse({ data: cachedContent });
    return true;
  }

  if (message.type === "CONTENT_EXTRACTED") {
    cachedContent = message.data;
    chrome.runtime.sendMessage({ type: "CONTENT_READY", data: cachedContent })
      .catch(() => {});
  }
});

// ── Stage 6: Context menu (logic authored in synthesize-selection.js) ─────────
// importScripts is avoided because Chrome MV3 resolves paths relative to the
// service worker file's directory (background/), not the extension root,
// making ../  paths unreliable across Chrome versions.
// The registration code is inlined here; synthesize-selection.js is preserved
// as the spec-required file and source of truth for this logic.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "episteme-synthesize",
      title: "Synthesize selection with Episteme",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "episteme-synthesize") return;
  if (!info.selectionText || !tab) return;

  cachedContent = {
    text: info.selectionText,
    title: tab.title ? `Selection from: ${tab.title}` : "Selected text",
    author: null,
    url: tab.url || "",
  };

  chrome.sidePanel.open({ tabId: tab.id });
  chrome.runtime.sendMessage({ type: "CONTENT_READY", data: cachedContent })
    .catch(() => {});
});
