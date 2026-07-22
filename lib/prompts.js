"use strict";

/**
 * THESIS_EXTRACTION_PROMPT
 *
 * Template function that takes raw article text and returns the full prompt
 * string to send to Gemini for thesis + assertion extraction.
 *
 * @param {string} articleText
 * @returns {string}
 */
function THESIS_EXTRACTION_PROMPT(articleText) {
  return `You are an academic reading assistant. Given an article text, extract:
1. The single central thesis the author is arguing.
2. Up to 5 specific factual or logical assertions that support that thesis.
3. Domain tags (1–4 short labels like "machine-learning", "nlp", "systems").

You MUST return strict JSON only. No markdown fences. No preamble. No trailing text.
The JSON must match this exact shape:

{
  "thesis": "string",
  "assertions": [
    { "text": "string", "source_quote": "string" }
  ],
  "domain_tags": ["string"]
}

Rules:
- "thesis" is one declarative sentence.
- Each "text" is a concise restatement of the assertion in your own words.
- Each "source_quote" is a verbatim substring from the article, no longer than 2 sentences.
- "domain_tags" contains 1–4 lowercase hyphenated labels.
- Return nothing except the JSON object.

ARTICLE TEXT:
${articleText}`;
}

/**
 * COLLISION_ANALYSIS_PROMPT
 *
 * Template function that takes the new article's thesis + assertions and
 * an array of retrieved similar articles, and returns the full prompt string
 * for Gemini to produce a relationship analysis.
 *
 * @param {string} newThesis
 * @param {Array<{ text: string }>} newAssertions
 * @param {Array<{ id: string, thesis: string, assertions: Array<{ text: string }> }>} retrievedArticles
 * @returns {string}
 */
function COLLISION_ANALYSIS_PROMPT(newThesis, newAssertions, retrievedArticles) {
  const newAssertionsList = newAssertions.map((a, i) => `  ${i + 1}. ${a.text}`).join("\n");

  const retrievedBlock = retrievedArticles.map((article) => {
    const assertionsList = article.assertions.map((a, i) => `    ${i + 1}. ${a.text}`).join("\n");
    return `Article ID: ${article.id}\nThesis: ${article.thesis}\nAssertions:\n${assertionsList}`;
  }).join("\n\n---\n\n");

  return `You are an academic knowledge analyst. You will compare a NEW article against HISTORICAL articles and classify their intellectual relationship.

NEW ARTICLE
Thesis: ${newThesis}
Assertions:
${newAssertionsList}

HISTORICAL ARTICLES
${retrievedBlock}

TASK
For each historical article, determine the relationship to the new article and cite the specific assertions that best illustrate it.

You MUST return strict JSON only. No markdown fences. No preamble. No trailing text.
Return an array of up to ${retrievedArticles.length} objects matching this exact shape:

[
  {
    "compared_article_id": "the UUID of the historical article",
    "relationship": "SUPPORTS or CONTRADICTS or EXTENDS or NONE",
    "cited_assertion_new": "copy the exact text of one assertion from the NEW article",
    "cited_assertion_historical": "copy the exact text of one assertion from the HISTORICAL article",
    "rationale": "max 2 sentences explaining the relationship"
  }
]

Rules:
- "relationship" must be exactly one of: SUPPORTS, CONTRADICTS, EXTENDS, NONE.
- "cited_assertion_new" must be copied verbatim from the NEW article assertions list above.
- "cited_assertion_historical" must be copied verbatim from that HISTORICAL article's assertions list above.
- "rationale" is at most 2 sentences.
- Return one object per historical article, even if the relationship is NONE.
- Return nothing except the JSON array.`;
}

module.exports = { THESIS_EXTRACTION_PROMPT, COLLISION_ANALYSIS_PROMPT };
