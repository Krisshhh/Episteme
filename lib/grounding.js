"use strict";

const stringSimilarity = require("string-similarity");

const GROUNDING_THRESHOLD = 0.9;
const WINDOW_SIZE = 200; // characters per sliding window slice

/**
 * For a single quote string, checks whether it is grounded in sourceText
 * using an exact substring check first, then a sliding-window similarity scan.
 *
 * @param {string} quote
 * @param {string} sourceText
 * @returns {boolean}
 */
function isGrounded(quote, sourceText) {
  if (!quote || !sourceText) return false;

  // Fast path: verbatim substring
  if (sourceText.includes(quote)) return true;

  const step = Math.max(1, Math.floor(WINDOW_SIZE / 2));
  const windows = [];

  for (let i = 0; i + WINDOW_SIZE <= sourceText.length; i += step) {
    windows.push(sourceText.slice(i, i + WINDOW_SIZE));
  }

  // Cover short texts and any remaining tail
  if (sourceText.length < WINDOW_SIZE) {
    windows.push(sourceText);
  } else if (sourceText.length % step !== 0) {
    windows.push(sourceText.slice(sourceText.length - WINDOW_SIZE));
  }

  for (const window of windows) {
    if (stringSimilarity.compareTwoStrings(quote, window) >= GROUNDING_THRESHOLD) {
      return true;
    }
  }

  return false;
}

/**
 * Adds a `grounded` boolean field to each assertion by checking whether
 * its `source_quote` appears in sourceText.
 *
 * @param {Array<{ text: string, source_quote: string }>} assertions
 * @param {string} sourceText
 * @returns {Array<{ text: string, source_quote: string, grounded: boolean }>}
 */
function validateGrounding(assertions, sourceText) {
  return assertions.map((assertion) => ({
    ...assertion,
    grounded: isGrounded(assertion.source_quote, sourceText),
  }));
}

module.exports = { validateGrounding };
