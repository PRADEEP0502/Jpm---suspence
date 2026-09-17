'use strict';

/**
 * JPM Suspense Amount Dashboard - web server.
 *
 *   npm start            -> http://localhost:3000  (also reachable from other office PCs on the LAN)
 *
 * Configuration (environment variables, all optional):
 *   PORT                   default 3000
 *   HOST                   default 0.0.0.0 (all network interfaces)
 *   APP_TIMEZONE           default Asia/Kolkata - used for "today" and age calculation
 *   SEED_SAMPLE_DATA       default true - add the 4 sample entries when the database is first created
 *   ADMIN_USERNAME / ADMIN_PASSWORD  initial admin login (default admin / Admin@123, must be changed on first login)
 *   DATA_DIR               default ./data
 *   SESSION_HOURS          default 12
 *   COOKIE_SECURE          default false - set true when served over HTTPS
 */

const os = require('os');
const path = require('path');
const express = require('express');

const db = require('./src/db');
const auth = require('./src/auth');
const entries = require('./src/entries');
const users = require('./src/users');
const audit = require('./src/audit');
const { seedSampleData } = require('./src/seed');
const { HttpError, AGE_BUCKETS, DEFAULT_PARTICULARS, TIMEZONE, todayISO } = require('./src/util');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SEED_SAMPLE_DATA = String(process.env.SEED_SAMPLE_DATA || 'true').toLowerCase() !== 'false';

const wrap = (fn) => (req, res, next) => {
  try {
    const result = fn(req, res);
    if (result !== undefined) res.json(result);
  } catch (err) {
    next(err);
  }
};

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

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
    wrap((req, res) => ({ user: auth.login(req, res, req.body.username, req.body.password) }))
  );

  api.post(
    '/auth/logout',
    wrap((req, res) => {
      auth.destroySession(req, res);
      return { ok: true };
    })
  );

  api.post(
    '/auth/change-password',
    (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue.'))),
    wrap((req) => ({ user: auth.changePassword(req, req.body.currentPassword, req.body.newPassword) }))
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

  api.get('/entries/next-srn', auth.requireLogin, wrap(() => ({ srn: entries.nextSrn() })));

  api.get(
    '/entries/:id',
    wrap((req) => {
      const isAdmin = req.user && req.user.role === 'ADMIN';
      const entry = entries.getEntry(req.params.id, { includeDeleted: isAdmin });
      if (!entry) throw new HttpError(404, 'Entry not found.');
      // Change history is shown to logged-in staff only.
      const history = req.user ? audit.historyForEntry(entry.id) : undefined;
      return { entry, history };
    })
  );

  api.post('/entries', auth.requireLogin, wrap((req) => ({ entry: entries.createEntry(req.body, req.user) })));
  api.put(
    '/entries/:id',
    auth.requireLogin,
    wrap((req) => ({ entry: entries.updateEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/close',
    auth.requireLogin,
    wrap((req) => ({ entry: entries.closeEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/reopen',
    auth.requireAdmin,
    wrap((req) => ({ entry: entries.reopenEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/delete',
    auth.requireAdmin,
    wrap((req) => ({ entry: entries.deleteEntry(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/entries/:id/restore',
    auth.requireAdmin,
    wrap((req) => ({ entry: entries.restoreEntry(req.params.id, req.user) }))
  );

  // User management (admin)
  api.get('/users', auth.requireAdmin, wrap(() => ({ users: users.listUsers() })));
  api.post('/users', auth.requireAdmin, wrap((req) => ({ user: users.createUser(req.body, req.user) })));
  api.put('/users/:id', auth.requireAdmin, wrap((req) => ({ user: users.updateUser(req.params.id, req.body, req.user) })));
  api.post(
    '/users/:id/reset-password',
    auth.requireAdmin,
    wrap((req) => ({ user: users.resetPassword(req.params.id, req.body, req.user) }))
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
  const { isNew, file } = await db.openDatabase();
  const admin = users.ensureDefaultAdmin();
  if (isNew && SEED_SAMPLE_DATA) {
    const n = seedSampleData();
    console.log(`[setup] Added ${n} sample suspense entries.`);
  }

  buildApp().listen(PORT, HOST, () => {
    console.log('');
    console.log('  JPM Suspense Amount Dashboard is running');
    console.log(`  Database : ${file}`);
    console.log(`  Today    : ${todayISO()} (${TIMEZONE})`);
    console.log(`  Open     : http://localhost:${PORT}`);
    lanAddresses().forEach((ip) => console.log(`  Network  : http://${ip}:${PORT}`));
    if (admin) {
      console.log('');
      console.log(`  First-time admin login  ->  ID: ${admin.username}   Password: ${admin.password}`);
      console.log('  (You will be asked to set a new password after the first login.)');
    }
    console.log('');
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}

module.exports = { buildApp };
