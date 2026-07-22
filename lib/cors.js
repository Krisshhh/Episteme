"use strict";

/**
 * Applies CORS headers to every response so Chrome extensions and browsers
 * on any origin can call the API. Also handles OPTIONS preflight.
 *
 * Usage in a handler:
 *   if (applyCors(req, res)) return;   // returns true only for OPTIONS
 *
 * @param {object} req
 * @param {object} res
 * @returns {boolean} true if this was a preflight — handler should return immediately
 */
function applyCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors };
