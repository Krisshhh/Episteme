"use strict";

// Loaded into the service worker via importScripts() — runs in service worker
// scope, so it shares cachedContent and all chrome.* APIs with service-worker.js.

// Register context menu on install / extension reload.
// removeAll first to prevent "duplicate ID" errors when the extension is
// reloaded during development.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "episteme-synthesize",
      title: "Synthesize selection with Episteme",
      contexts: ["selection"],   // visible ONLY when text is selected
    });
  });
});

// Handle context menu click.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "episteme-synthesize") return;
  if (!info.selectionText || !tab) return;

  // Build the same content shape that extract-content.js produces,
  // but using ONLY the selected text — not the full page.
  cachedContent = {
    text: info.selectionText,
    title: tab.title ? `Selection from: ${tab.title}` : "Selected text",
    author: null,
    url: tab.url || "",
  };

  // Open the side panel and broadcast — panel.js processContent() handles
  // the rest without any modification to panel.js.
  chrome.sidePanel.open({ tabId: tab.id });
  chrome.runtime.sendMessage({ type: "CONTENT_READY", data: cachedContent })
    .catch(() => {});
});
