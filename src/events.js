'use strict';

/**
 * Live updates: the browser keeps one open connection (Server-Sent Events) and the
 * server tells it whenever the data changes, so every screen stays current within a
 * second instead of waiting for the next refresh.
 *
 * Two sources feed it:
 *   - this server's own add / edit / close / delete routes
 *   - a MongoDB change stream, so changes made by another server (or directly in
 *     Atlas / Compass) also reach every browser
 */

const HEARTBEAT_MS = 25000; // keeps proxies from closing an idle connection
const THROTTLE_MS = 300; // several writes in quick succession -> one notification

const clients = new Set();
let pending = null;
let lastSentAt = 0;

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write('event: ready\ndata: {}\n\n');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const client = { res };
  clients.add(client);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      /* the cleanup below will remove it */
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
}

function send(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {
    try {
      client.res.write(payload);
    } catch (_) {
      clients.delete(client);
    }
  }
}

/** Tell every open screen that entries changed (throttled). */
function notifyChanged(reason = 'update') {
  const now = Date.now();
  const elapsed = now - lastSentAt;
  if (elapsed >= THROTTLE_MS) {
    lastSentAt = now;
    send('changed', { reason, at: new Date().toISOString() });
    return;
  }
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    lastSentAt = Date.now();
    send('changed', { reason, at: new Date().toISOString() });
  }, THROTTLE_MS - elapsed);
  pending.unref();
}

const clientCount = () => clients.size;

function closeAll() {
  for (const client of [...clients]) {
    try {
      client.res.end();
    } catch (_) {
      /* ignore */
    }
  }
  clients.clear();
}

module.exports = { addClient, notifyChanged, clientCount, closeAll };
