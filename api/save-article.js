"use strict";

const { getEmbedding } = require("../lib/gemini");
const { supabase } = require("../lib/supabase");
const { applyCors } = require("../lib/cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { title, url, author, thesis, assertions } = req.body || {};

  if (!thesis || typeof thesis !== "string" || thesis.trim().length === 0) {
    return res.status(400).json({ error: "Missing or empty required field: thesis" });
  }

  if (!Array.isArray(assertions) || assertions.length === 0) {
    return res.status(400).json({ error: "Missing or empty required field: assertions" });
  }

  // Step 1 — Generate embedding for the thesis
  let embedding;
  try {
    embedding = await getEmbedding(thesis);
  } catch (err) {
    return res.status(502).json({ error: `Embedding error: ${err.message}` });
  }

  // Step 2 — Insert into articles table
  const { data: articleData, error: articleError } = await supabase
    .from("articles")
    .insert({
      title: title || null,
      url: url || null,
      author: author || null,
      thesis,
      embedding,
    })
    .select("id")
    .single();

  if (articleError) {
    return res.status(502).json({ error: `Article insert failed: ${articleError.message}` });
  }

  const article_id = articleData.id;

  // Step 3 — Insert each assertion linked to the article
  const assertionRows = assertions.map((a) => ({
    article_id,
    text: a.text,
    source_quote: a.source_quote,
    grounded: a.grounded === true,
  }));

  const { error: assertionsError } = await supabase
    .from("assertions")
    .insert(assertionRows);

  if (assertionsError) {
    // Manual rollback: delete the article row inserted in Step 2.
    // This is NOT a database transaction — a crash between delete and response
    // could still leave orphaned rows. Flagged as a known gap per spec.
    await supabase.from("articles").delete().eq("id", article_id);

    return res.status(502).json({
      error: `Assertions insert failed (article rolled back): ${assertionsError.message}`,
    });
  }

  return res.status(200).json({ article_id });
};
