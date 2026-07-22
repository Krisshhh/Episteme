"use strict";

const { supabase } = require("../lib/supabase");
const { callGemini } = require("../lib/gemini");
const { COLLISION_ANALYSIS_PROMPT } = require("../lib/prompts");
const stringSimilarity = require("string-similarity");
const { applyCors } = require("../lib/cors");

// Threshold for considering a cited assertion text a valid near-match
// against an actual assertion in the article's list.
const CITATION_MATCH_THRESHOLD = 0.75;

/**
 * Returns true if `cited` near-exactly matches any assertion text in `list`.
 *
 * @param {string} cited
 * @param {Array<{ text: string }>} list
 * @returns {boolean}
 */
function isCitationValid(cited, list) {
  if (!cited || !list || list.length === 0) return false;
  const texts = list.map((a) => a.text);
  // Exact match fast path
  if (texts.includes(cited)) return true;
  // Near-match via string similarity
  const { bestMatch } = stringSimilarity.findBestMatch(cited, texts);
  return bestMatch.rating >= CITATION_MATCH_THRESHOLD;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { article_id } = req.body || {};

  if (!article_id || typeof article_id !== "string") {
    return res.status(400).json({ error: "Missing or invalid required field: article_id" });
  }

  // ── Step 1: Fetch the target article (thesis + embedding) ──────────────────
  const { data: targetArticle, error: targetErr } = await supabase
    .from("articles")
    .select("id, thesis, embedding")
    .eq("id", article_id)
    .single();

  if (targetErr || !targetArticle) {
    return res.status(404).json({ error: `Article not found: ${article_id}` });
  }

  if (!targetArticle.embedding) {
    return res.status(422).json({ error: "Article has no embedding; cannot find collisions" });
  }

  // ── Step 2: Fetch the target article's assertions ─────────────────────────
  const { data: targetAssertions, error: taErr } = await supabase
    .from("assertions")
    .select("id, text")
    .eq("article_id", article_id);

  if (taErr) {
    return res.status(502).json({ error: `Failed to fetch assertions: ${taErr.message}` });
  }

  // ── Step 3: Find the 3 nearest articles via pgvector cosine distance ───────
  // Uses the match_articles Postgres function (see SQL below).
  // The embedding from Supabase arrives as a serialized string "[x,y,...]".
  const embeddingArray =
    typeof targetArticle.embedding === "string"
      ? JSON.parse(targetArticle.embedding)
      : targetArticle.embedding;

  const { data: nearestArticles, error: matchErr } = await supabase.rpc("match_articles", {
    query_embedding: embeddingArray,
    exclude_id: article_id,
    match_count: 3,
  });

  if (matchErr) {
    return res.status(502).json({ error: `Vector search failed: ${matchErr.message}` });
  }

  if (!nearestArticles || nearestArticles.length === 0) {
    return res.status(200).json([]);
  }

  // ── Step 4: Fetch assertions for each retrieved article ───────────────────
  const retrievedIds = nearestArticles.map((a) => a.id);

  const { data: allAssertions, error: assErr } = await supabase
    .from("assertions")
    .select("id, article_id, text")
    .in("article_id", retrievedIds);

  if (assErr) {
    return res.status(502).json({ error: `Failed to fetch retrieved assertions: ${assErr.message}` });
  }

  // Group assertions by article_id
  const assertionsByArticle = {};
  for (const a of allAssertions || []) {
    if (!assertionsByArticle[a.article_id]) assertionsByArticle[a.article_id] = [];
    assertionsByArticle[a.article_id].push(a);
  }

  const retrievedArticles = nearestArticles.map((a) => ({
    id: a.id,
    thesis: a.thesis,
    assertions: assertionsByArticle[a.id] || [],
  }));

  // ── Step 5: Call Gemini for relationship analysis ─────────────────────────
  const prompt = COLLISION_ANALYSIS_PROMPT(
    targetArticle.thesis,
    targetAssertions,
    retrievedArticles
  );

  let rawResponse;
  try {
    rawResponse = await callGemini(prompt);
  } catch (err) {
    return res.status(502).json({ error: `Gemini API error: ${err.message}` });
  }

  let relationships;
  try {
    relationships = JSON.parse(rawResponse);
  } catch (_) {
    return res.status(502).json({ error: "Gemini returned non-JSON response" });
  }

  if (!Array.isArray(relationships)) {
    return res.status(502).json({ error: "Gemini response is not a JSON array" });
  }

  // ── Step 6: Validate citations + build final result array ─────────────────
  const validRelationships = ["SUPPORTS", "CONTRADICTS", "EXTENDS", "NONE"];

  const result = relationships.map((item) => {
    // Find the historical article this item refers to
    const historicalArticle = retrievedArticles.find(
      (a) => a.id === item.compared_article_id
    );

    const newCitationValid = isCitationValid(item.cited_assertion_new, targetAssertions);
    const historicalCitationValid =
      historicalArticle
        ? isCitationValid(item.cited_assertion_historical, historicalArticle.assertions)
        : false;

    const citation_valid = newCitationValid && historicalCitationValid;
    const relationship = validRelationships.includes(item.relationship)
      ? item.relationship
      : "NONE";

    return {
      compared_article_id: item.compared_article_id,
      relationship,
      cited_assertion_new: item.cited_assertion_new,
      cited_assertion_historical: item.cited_assertion_historical,
      rationale: item.rationale || null,
      citation_valid,
    };
  });

  // ── Step 7: Insert non-NONE, citation-valid edges into edges table ─────────
  const edgesToInsert = result.filter(
    (item) => item.relationship !== "NONE" && item.citation_valid === true
  );

  if (edgesToInsert.length > 0) {
    // Resolve assertion IDs for cited texts
    const edgeRows = edgesToInsert.map((item) => {
      const assertionA = targetAssertions.find((a) => a.text === item.cited_assertion_new);
      const historicalArticle = retrievedArticles.find(
        (a) => a.id === item.compared_article_id
      );
      const assertionB = historicalArticle
        ? historicalArticle.assertions.find((a) => a.text === item.cited_assertion_historical)
        : null;

      return {
        article_a_id: article_id,
        article_b_id: item.compared_article_id,
        relationship: item.relationship,
        cited_assertion_a: assertionA ? assertionA.id : null,
        cited_assertion_b: assertionB ? assertionB.id : null,
        rationale: item.rationale,
      };
    });

    const { error: edgeErr } = await supabase.from("edges").insert(edgeRows);

    if (edgeErr) {
      // Non-fatal: return results but surface the edge write error
      return res.status(200).json({
        relationships: result,
        warning: `Edge insert failed: ${edgeErr.message}`,
      });
    }
  }

  return res.status(200).json(result);
};
