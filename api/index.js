'use strict';

/**
 * Vercel entry point. Vercel serves public/ from its CDN and sends every /api/* request here
 * (see vercel.json). The same Express app as server.js handles it; the one-time setup
 * (database connection, indexes, default admin) runs on the first request of each instance.
 */

const { buildApp, prepare } = require('../server');

const app = buildApp();
let ready = null;

module.exports = async (req, res) => {
  if (!ready) {
    ready = prepare().catch((err) => {
      ready = null; // try again on the next request
      throw err;
    });
  }
  try {
    await ready;
  } catch (err) {
    console.error('[vercel] database not reachable:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'The database is not reachable right now. Please try again in a moment.' }));
    return;
  }
  return app(req, res);
};
