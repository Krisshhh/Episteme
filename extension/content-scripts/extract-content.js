(function () {
  "use strict";

  // Clone the live document so Readability can prune it without affecting
  // the page the user is reading.
  const documentClone = document.cloneNode(true);
  const reader = new Readability(documentClone);
  const article = reader.parse();

  const payload = {
    text: article ? article.textContent.trim() : document.body.innerText.trim(),
    title: article ? article.title : document.title,
    author: article ? (article.byline || null) : null,
    url: window.location.href,
  };

  chrome.runtime.sendMessage({ type: "CONTENT_EXTRACTED", data: payload });
})();
