"use strict";

const { supabase } = require("../lib/supabase");
const { applyCors } = require("../lib/cors");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Fetch all articles (no embedding — too large for the panel)
    const { data: articles, error: articlesErr } = await supabase
      .from("articles")
      .select("id, title, author, url, thesis, created_at")
      .order("created_at", { ascending: false });

    if (articlesErr) {
      return res.status(502).json({ error: `Failed to fetch articles: ${articlesErr.message}` });
    }

    // 2. Fetch all edges
    const { data: edges, error: edgesErr } = await supabase
      .from("edges")
      .select("id, article_a_id, article_b_id, relationship, rationale");

    if (edgesErr) {
      return res.status(502).json({ error: `Failed to fetch edges: ${edgesErr.message}` });
    }

    // 3. Build a title lookup map for peer labelling
    const titleMap = {};
    for (const a of articles || []) titleMap[a.id] = a.title;

    // 4. Join edges onto each article — frontend needs no further processing
    const library = (articles || []).map((article) => {
      const articleEdges = (edges || [])
        .filter((e) => e.article_a_id === article.id || e.article_b_id === article.id)
        .map((e) => {
          const isSource = e.article_a_id === article.id;
          const peerId = isSource ? e.article_b_id : e.article_a_id;
          return {
            id: e.id,
            relationship: e.relationship,
            rationale: e.rationale,
            peer_id: peerId,
            peer_title: titleMap[peerId] || "Unknown Article",
            direction: isSource ? "outgoing" : "incoming",
          };
        });

      return { ...article, edges: articleEdges };
    });

    return res.status(200).json(library);
  } catch (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
};
