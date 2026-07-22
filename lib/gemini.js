"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");

// gemini-2.0-flash quota is exhausted on the free tier for this key.
// gemini-flash-latest is confirmed working and resolves to the latest
// available flash model that has available quota.
const GENERATION_MODEL = "gemini-flash-latest";

// text-embedding-004 is unavailable on this key's API tier.
// gemini-embedding-001 natively returns 3072 dims but supports Matryoshka
// truncation via outputDimensionality. We lock to 768 to match the spec and
// stay within pgvector ivfflat's 2000-dimension hard limit.
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMS = 768;

/**
 * Calls the Gemini generation model with the given prompt string.
 * Reads GEMINI_API_KEY from process.env.
 * Returns the raw text response from the model.
 *
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * Generates a vector embedding for the given text using gemini-embedding-001.
 * Returns a float array of length EMBEDDING_DIMS (3072).
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function getEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

  const result = await model.embedContent({
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMS,
  });
  const values = result.embedding.values;

  if (values.length !== EMBEDDING_DIMS) {
    throw new Error(
      `Unexpected embedding dimensions: got ${values.length}, expected ${EMBEDDING_DIMS}`
    );
  }

  return values;
}

module.exports = { callGemini, getEmbedding };
