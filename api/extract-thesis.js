"use strict";

const { callGemini } = require("../lib/gemini");
const { validateGrounding } = require("../lib/grounding");
const { THESIS_EXTRACTION_PROMPT } = require("../lib/prompts");
const { applyCors } = require("../lib/cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, title, url, author } = req.body || {};

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Missing or empty required field: text" });
  }

  let rawResponse;
  try {
    rawResponse = await callGemini(THESIS_EXTRACTION_PROMPT(text));
  } catch (err) {
    return res.status(502).json({ error: `Gemini API error: ${err.message}` });
  }

  let parsed;
  try {
    parsed = JSON.parse(rawResponse);
  } catch (_) {
    return res.status(502).json({ error: "Gemini returned non-JSON response" });
  }

  if (
    typeof parsed.thesis !== "string" ||
    !Array.isArray(parsed.assertions) ||
    !Array.isArray(parsed.domain_tags)
  ) {
    return res.status(502).json({ error: "Gemini response did not match expected schema" });
  }

  const groundedAssertions = validateGrounding(parsed.assertions, text);

  return res.status(200).json({
    thesis: parsed.thesis,
    assertions: groundedAssertions,
    domain_tags: parsed.domain_tags,
    meta: { title: title || null, url: url || null, author: author || null },
  });
};
