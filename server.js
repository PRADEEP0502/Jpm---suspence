'use strict';

/**
 * JPM Suspense Amount Dashboard - web server.
 *
 *   npm start            -> http://localhost:3000  (also reachable from other office PCs on the LAN)
 *
 * Data is stored in MongoDB (Atlas or any MongoDB server). The connection string lives in .env,
 * which is never committed - copy .env.example to .env and fill in your details.
 *
 * Optional settings (environment variables or .env): PORT, HOST, APP_TIMEZONE, MONGODB_DB,
 * SEED_SAMPLE_DATA, ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_HOURS, COOKIE_SECURE,
 * BACKUP_DIR, BACKUP_KEEP_DAYS, AUTO_BACKUP.
 */

const os = require('os');
const path = require('path');
const express = require('express');

const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const entries = require('./src/entries');
const users = require('./src/users');
const audit = require('./src/audit');
const backup = require('./src/backup');
const events = require('./src/events');
const { seedSampleData } = require('./src/seed');
const { HttpError, AGE_BUCKETS, DEFAULT_PARTICULARS, TIMEZONE, todayISO } = require('./src/util');

const startedAt = new Date();

/** Wrap a route handler: send whatever it returns as JSON, and pass errors to the error handler. */
const wrap = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req, res);
    if (result !== undefined && !res.headersSent) res.json(result);
  } catch (err) {
    next(err);
  }
};

/** Same as wrap(), but also tells every open screen that the data changed. */
const wrapWrite = (fn) =>
  wrap(async (req, res) => {
    const result = await fn(req, res);
    events.notifyChanged();
    return result;
  });

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    );
    next();
  });

  // ------------------------------------------------------------------ API
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(auth.requireJsonForWrites);
  api.use(auth.loadUser);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /** Is the app connected to the database? Useful for monitoring and for checking a new setup. */
  api.get(
    '/health',
    wrap(async () => {
      const ping = await db.ping();
      return {
        ok: ping.connected,
        database: config.MONGODB_DB,
        connected: ping.connected,
        responseMs: ping.responseMs,
        error: ping.error,
        entries: ping.connected ? await db.collections.entries().countDocuments({ isDeleted: false }) : null,
        liveScreens: events.clientCount(),
        today: todayISO(),
        startedAt: startedAt.toISOString(),
      };
    })
  );

  /** Live updates: the browser keeps this open and is told whenever entries change. */
  api.get('/events', (req, res) => events.addClient(req, res));

  // Session & app configuration
  api.get(
    '/bootstrap',
    wrap((req) => ({
      user: req.user,
      today: todayISO(),
      timezone: TIMEZONE,
      ageBuckets: AGE_BUCKETS,
      defaultParticulars: DEFAULT_PARTICULARS,
    }))
  );

  api.post(
    '/auth/login',
    wrap(async (req, res) => ({ user: await auth.login(req, res, req.body.username, req.body.password) }))
  );

  api.post(
    '/auth/logout',
    wrap(async (req, res) => {
      await auth.destroySession(req, res);
      return { ok: true };
    })
  );

  api.post(
    '/auth/change-password',
    (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue.'))),
    wrap(async (req) => ({ user: await auth.changePassword(req, req.body.currentPassword, req.body.newPassword) }))
  );

  // Dashboard data (everyone, view-only)
  api.get('/dashboard', wrap(() => entries.dashboardSummary()));

  api.get('/lookups', wrap(() => entries.lookups()));

  api.get(
    '/entries',
    wrap((req) => {
      const status = String(req.query.status || 'ALL').toUpperCase();
      if (status === 'DELETED' && (!req.user || req.user.role !== 'ADMIN')) {
        throw new HttpError(403, 'Only an administrator can do this.');
      }
      return entries.listEntries(req.query);
    })
  );

  api.get('/entries/next-srn', auth.requireLogin, wrap(async () => ({ srn: await entries.nextSrn() })));

  api.get(
    '/entries/:id',
    wrap(async (req) => {
      const isAdmin = req.user && req.user.role === 'ADMIN';
      const entry = await entries.getEntry(req.params.id, { includeDeleted: isAdmin });
      if (!entry) throw new HttpError(404, 'Entry not found.');
      // Change history is shown to logged-in staff only.
      const history = req.user ? await audit.historyForEntry(entry.id) : undefined;
      return { entry, history };
    })
  );

  api.post(
    '/entries',
    auth.requireLogin,
    wrapWrite(async (req) => ({ entry: await entries.createEntry(req.body, req.user) }))
  );
  api.put(
    '/entries/:id',
    auth.requireLogin,
    wrapWrite(async (req) => ({ entry: await entries.updateEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/close',
    auth.requireLogin,
    wrapWrite(async (req) => ({ entry: await entries.closeEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/reopen',
    auth.requireAdmin,
    wrapWrite(async (req) => ({ entry: await entries.reopenEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/delete',
    auth.requireAdmin,
    wrapWrite(async (req) => ({ entry: await entries.deleteEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/restore',
    auth.requireAdmin,
    wrapWrite(async (req) => ({ entry: await entries.restoreEntry(req.params.id, req.user) }))
  );

  // User management (admin)
  api.get('/users', auth.requireAdmin, wrap(async () => ({ users: await users.listUsers() })));
  api.post('/users', auth.requireAdmin, wrap(async (req) => ({ user: await users.createUser(req.body, req.user) })));
  api.put(
    '/users/:id',
    auth.requireAdmin,
    wrap(async (req) => ({ user: await users.updateUser(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/users/:id/reset-password',
    auth.requireAdmin,
    wrap(async (req) => ({ user: await users.resetPassword(req.params.id, req.body, req.user) }))
  );

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));

  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid request data.');
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message,
      code: err.code,
      field: err.field,
    });
  });

  app.use('/api', api);

  // ------------------------------------------------------------------ Frontend
  app.use(
    express.static(path.join(__dirname, 'public'), {
      index: 'index.html',
      setHeaders(res, filePath) {
        // Always pick up new versions of the app after an update.
        res.setHeader('Cache-Control', 'no-cache');
        if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      },
    })
  );

  return app;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

async function main() {
  let info;
  try {
    info = await db.openDatabase();
  } catch (err) {
    console.error('\n  Could not connect to the database.\n');
    console.error(`  ${err.message}\n`);
    console.error('  Things to check:');
    console.error('   - .env has the correct MONGODB_URI (user name, password, cluster)');
    console.error('   - in MongoDB Atlas, Network Access allows this computer’s IP address');
    console.error('   - this computer is online\n');
    process.exit(1);
  }

  const admin = await users.ensureDefaultAdmin();
  if (info.isNew && config.SEED_SAMPLE_DATA) {
    const n = await seedSampleData();
    console.log(`[setup] Added ${n} sample suspense entries.`);
  }
  await db.syncSrnCounter();
  backup.startDailyBackups();

  // Changes made by another server (or directly in Atlas) also reach every open screen.
  const live = db.watchEntries(() => events.notifyChanged('database'));

  const server = buildApp().listen(config.PORT, config.HOST, () => {
    console.log('');
    console.log('  JPM Suspense Amount Dashboard is running');
    console.log(`  Database : ${info.name} on ${info.host}`);
    console.log(`  Live     : ${live ? 'on (screens update as soon as anyone saves)' : 'on (this server only)'}`);
    console.log(`  Today    : ${todayISO()} (${TIMEZONE})`);
    console.log(`  Open     : http://localhost:${config.PORT}`);
    lanAddresses().forEach((ip) => console.log(`  Network  : http://${ip}:${config.PORT}`));
    if (admin) {
      console.log('');
      console.log(`  First-time admin login  ->  ID: ${admin.username}   Password: ${admin.password}`);
      console.log('  (You will be asked to set a new password after the first login.)');
    }
    console.log('');
  });

  // Close tidily on Ctrl+C or when Windows closes the window, so nothing is left half-written.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  Stopping (${signal})...`);
    events.closeAll();
    server.close();
    try {
      await db.closeDatabase();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  };
  ['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((signal) => process.on(signal, () => shutdown(signal)));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { buildApp };
