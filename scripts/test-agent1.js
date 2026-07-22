// ============================================================
// scripts/test-agent1.js — Stage 1: Standalone thesis extractor
// Runs via: node scripts/test-agent1.js
// Requires: GEMINI_API_KEY in .env.local
// ============================================================

"use strict";

require("dotenv").config({ path: ".env.local" });

const { GoogleGenerativeAI } = require("@google/generative-ai");
const stringSimilarity = require("string-similarity");

// ============================================================
// SAMPLE_TEXT — ~500 words from "Attention Is All You Need"
// Vaswani et al., 2017 (https://arxiv.org/abs/1706.03762)
// ============================================================
const SAMPLE_TEXT = `
The dominant sequence transduction models are based on complex recurrent or convolutional neural
networks that include an encoder and a decoder. The best performing models also connect the encoder
and decoder through an attention mechanism. We propose a new simple network architecture, the
Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions
entirely. Experiments on two machine translation tasks show these models to be superior in quality
while being more parallelizable and requiring significantly less time to train. Our model achieves
28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best
results, including ensembles, by over 2 BLEU. On the WMT 2014 English-to-French translation task,
our model establishes a new single-model state-of-the-art BLEU score of 41.0 after training for 3.5
days on eight GPUs, a small fraction of the training costs of the best models from the literature.

Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular,
have been firmly established as state of the art approaches in sequence modeling and transduction
problems such as language modeling and machine translation. Numerous efforts have since continued to
push the boundaries of recurrent language models and encoder-decoder architectures.

Recurrent models typically factor computation along the symbol positions of the input and output
sequences. Aligning the positions to steps in computation time, they generate a sequence of hidden
states h_t, as a function of the previous hidden state h_{t-1} and the input for position t. This
inherently sequential nature precludes parallelization within training examples, which becomes
critical at longer sequence lengths, as memory constraints limit batching across examples.

Attention mechanisms have become an integral part of compelling sequence modeling and transduction
models in various tasks, allowing modeling of dependencies without regard to their distance in the
input or output sequences. In all but a few cases, however, such attention mechanisms are used in
conjunction with a recurrent network.

In this work we propose the Transformer, a model architecture eschewing recurrence and instead
relying entirely on an attention mechanism to draw global dependencies between input and output. The
Transformer allows for significantly more parallelization and can reach a new state of the art in
translation quality after being trained for as little as twelve hours on eight P100 GPUs.

To the best of our knowledge, however, the Transformer is the first transduction model relying
entirely on self-attention to compute representations of its input and output without using
sequence-aligned RNNs or convolution. We believe the Transformer is a significant step toward
truly parallelizable and trainable sequence-to-sequence models, and its implications extend well
beyond machine translation to any task requiring global context understanding.
`.trim();

// ============================================================
// SYSTEM PROMPT — inlined per Stage 1 rules (moves to lib/prompts.js in Stage 2)
// ============================================================
const SYSTEM_PROMPT = `You are an academic reading assistant. Given an article text, extract:
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
- Return nothing except the JSON object.`;

// ============================================================
// GROUNDING — sliding-window similarity check against SAMPLE_TEXT
// threshold: 0.9 (per spec)
// ============================================================
const GROUNDING_THRESHOLD = 0.9;
const WINDOW_SIZE = 200; // characters per window slice

/**
 * Checks whether a source_quote is grounded in sourceText using a
 * sliding-window string-similarity comparison.
 * Returns true if any window achieves similarity >= GROUNDING_THRESHOLD.
 *
 * @param {string} quote
 * @param {string} sourceText
 * @returns {boolean}
 */
function isGrounded(quote, sourceText) {
  if (!quote || !sourceText) return false;

  // Fast path: exact substring
  if (sourceText.includes(quote)) return true;

  const windows = [];
  const step = Math.max(1, Math.floor(WINDOW_SIZE / 2));

  for (let i = 0; i + WINDOW_SIZE <= sourceText.length; i += step) {
    windows.push(sourceText.slice(i, i + WINDOW_SIZE));
  }
  // Always include the final tail so short texts are covered
  if (sourceText.length < WINDOW_SIZE) {
    windows.push(sourceText);
  } else if (sourceText.length % step !== 0) {
    windows.push(sourceText.slice(sourceText.length - WINDOW_SIZE));
  }

  for (const window of windows) {
    const score = stringSimilarity.compareTwoStrings(quote, window);
    if (score >= GROUNDING_THRESHOLD) return true;
  }
  return false;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GEMINI_API_KEY is not set in .env.local");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const fullPrompt = `${SYSTEM_PROMPT}\n\nARTICLE TEXT:\n${SAMPLE_TEXT}`;

  let rawText;
  try {
    const result = await model.generateContent(fullPrompt);
    rawText = result.response.text();
  } catch (err) {
    console.error("ERROR: Gemini API call failed:", err.message);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (_parseErr) {
    console.error("ERROR: Gemini returned non-JSON response. Raw output below:");
    console.error(rawText);
    process.exit(1);
  }

  // Validate top-level shape
  if (
    typeof parsed.thesis !== "string" ||
    !Array.isArray(parsed.assertions) ||
    !Array.isArray(parsed.domain_tags)
  ) {
    console.error("ERROR: Parsed JSON does not match expected schema. Got:");
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  // Add grounded field to each assertion
  const groundedAssertions = parsed.assertions.map((assertion) => ({
    ...assertion,
    grounded: isGrounded(assertion.source_quote, SAMPLE_TEXT),
  }));

  const output = {
    thesis: parsed.thesis,
    assertions: groundedAssertions,
    domain_tags: parsed.domain_tags,
  };

  // Print final result to stdout
  console.log(JSON.stringify(output, null, 2));
}

main();
