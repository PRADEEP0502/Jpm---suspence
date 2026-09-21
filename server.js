'use strict';

/**
 * JPM Suspense Amount Dashboard - web server.
 *
 *   npm start            -> http://localhost:3000  (also reachable from other office PCs on the LAN)
 *
 * Data is stored in MongoDB (Atlas or any MongoDB server). The connection string lives in .env,
 * which is never committed - copy .env.example to .env and fill in your details.
 *
 * Access control is enforced HERE, on every request (see src/permissions.js):
 *   NORMAL  own records, view only        ENTRY  all records, add/edit/return
 *   ADMIN   full access                   MD     full access
 * Nothing is public except the sign-in page and the connection health check.
 */

const os = require('os');
const path = require('path');
const express = require('express');

const pkg = require('./package.json');
const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const entries = require('./src/entries');
const users = require('./src/users');
const audit = require('./src/audit');
const backup = require('./src/backup');
const events = require('./src/events');
const reports = require('./src/reports');
const permissions = require('./src/permissions');
const { seedSampleData } = require('./src/seed');
const { HttpError, AGE_BUCKETS, DEFAULT_PARTICULARS, TIMEZONE, todayISO } = require('./src/util');

const startedAt = new Date();
const { requirePermission, requireLogin } = auth;
const can = permissions.can;

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

/**
 * A user who may only see their own records must not even ask for someone else's. Any request that
 * names another person or user (userId=..., whom=..., ...) is refused outright. The queries are
 * ALSO limited to the caller's own records in the database (src/entries.js), so this is a second wall.
 */
function ownScopeGuard(req, _res, next) {
  if (!req.user || can(req.user, 'entries:viewAll')) return next();
  const mine = new Set([req.user.id, req.user.username, req.user.displayName].map((s) => String(s).toLowerCase()));
  for (const key of ['userId', 'givenToUserId', 'employeeId', 'user', 'username', 'person', 'whom', 'givenTo']) {
    const raw = req.query[key];
    if (raw === undefined || raw === '') continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.some((v) => !mine.has(String(v).toLowerCase()))) {
      return next(new HttpError(403, 'You can only view your own records.', { code: 'FORBIDDEN' }));
    }
  }
  next();
}

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

  // ---- Public: sign-in, session info and a bare connection check (no data)
  api.get(
    '/health',
    wrap(async () => {
      const ping = await db.ping();
      return { ok: ping.connected, connected: ping.connected, responseMs: ping.responseMs, today: todayISO() };
    })
  );

  api.get(
    '/bootstrap',
    wrap((req) => ({
      user: req.user,
      today: todayISO(),
      timezone: TIMEZONE,
      ageBuckets: AGE_BUCKETS,
      defaultParticulars: DEFAULT_PARTICULARS,
      roles: permissions.ROLES.map((r) => ({ key: r, label: permissions.ROLE_LABELS[r] })),
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

  // ---- Everything below needs a signed-in user with the right permission
  api.get('/events', requireLogin, (req, res) => events.addClient(req, res));

  const view = requirePermission('own:view', 'entries:viewAll');

  api.get('/dashboard', view, ownScopeGuard, wrap((req) => entries.dashboardSummary(req.user)));
  api.get('/lookups', requirePermission('entries:viewAll'), wrap((req) => entries.lookups(req.user)));

  // Suspense entries. Also reachable as /api/suspense.
  const suspense = express.Router();
  suspense.get('/', view, ownScopeGuard, wrap((req) => entries.listEntries(req.query, req.user)));
  suspense.get('/next-srn', requirePermission('entries:add'), wrap(async () => ({ srn: await entries.nextSrn() })));
  suspense.get(
    '/:id',
    view,
    ownScopeGuard,
    wrap(async (req) => {
      const entry = await entries.getEntry(req.params.id, req.user);
      if (!entry) throw new HttpError(404, 'Entry not found.');
      // The internal change history is for staff who can see everything.
      const history = can(req.user, 'entries:viewAll') ? await audit.historyForEntry(entry.id) : undefined;
      return { entry, history };
    })
  );
  suspense.post(
    '/',
    requirePermission('entries:add'),
    wrapWrite(async (req) => ({ entry: await entries.createEntry(req.body, req.user) }))
  );
  suspense.put(
    '/:id',
    requirePermission('entries:edit'),
    wrapWrite(async (req) => ({ entry: await entries.updateEntry(req.params.id, req.body, req.user) }))
  );
  suspense.post(
    '/:id/returns',
    requirePermission('entries:return'),
    wrapWrite(async (req) => ({ entry: await entries.addReturn(req.params.id, req.body, req.user) }))
  );
  suspense.post(
    '/:id/close',
    requirePermission('entries:close'),
    wrapWrite(async (req) => ({ entry: await entries.closeEntry(req.params.id) }))
  );
  suspense.post(
    '/:id/reopen',
    requirePermission('entries:reopen'),
    wrapWrite(async (req) => ({ entry: await entries.reopenEntry(req.params.id, req.body, req.user) }))
  );
  suspense.post(
    '/:id/delete',
    requirePermission('entries:delete'),
    wrapWrite(async (req) => ({ entry: await entries.deleteEntry(req.params.id, req.body, req.user) }))
  );
  suspense.post(
    '/:id/restore',
    requirePermission('entries:delete'),
    wrapWrite(async (req) => ({ entry: await entries.restoreEntry(req.params.id, req.user) }))
  );
  api.use('/entries', suspense);
  api.use('/suspense', suspense);

  // ---- User management: Admin and MD only
  api.get('/users', requirePermission('users:manage'), wrap(async () => ({ users: await users.listUsers() })));
  api.post(
    '/users',
    requirePermission('users:manage'),
    wrapWrite(async (req) => ({ user: await users.createUser(req.body, req.user) }))
  );
  api.put(
    '/users/:id',
    requirePermission('users:manage'),
    wrapWrite(async (req) => ({ user: await users.updateUser(req.params.id, req.body, req.user) }))
  );
  api.post(
    '/users/:id/reset-password',
    requirePermission('users:manage'),
    wrap(async (req) => ({ user: await users.resetPassword(req.params.id, req.body, req.user) }))
  );

  // ---- Reports (CSV downloads): Admin and MD
  api.get('/reports', requirePermission('reports:view'), wrap(() => ({ reports: reports.REPORT_LIST })));
  api.get(
    '/reports/:key.csv',
    requirePermission('reports:view'),
    wrap(async (req, res) => {
      const csv = await reports.build(req.params.key, req.user);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="jpm-${req.params.key}-${todayISO()}.csv"`);
      res.send(csv);
    })
  );

  // ---- System settings and backup: Admin and MD
  api.get(
    '/system',
    requirePermission('system:manage'),
    wrap(async () => {
      const ping = await db.ping();
      return {
        version: pkg.version,
        database: config.MONGODB_DB,
        connected: ping.connected,
        responseMs: ping.responseMs,
        timezone: TIMEZONE,
        today: todayISO(),
        sessionHours: config.SESSION_HOURS,
        startedAt: startedAt.toISOString(),
        liveScreens: events.clientCount(),
        entries: await db.collections.entries().countDocuments({ isDeleted: false }),
        roleCounts: await users.roleCounts(),
        roles: permissions.ROLES.map((r) => ({
          key: r,
          label: permissions.ROLE_LABELS[r],
          permissions: permissions.permissionsFor(r),
        })),
        permissions: permissions.PERMISSIONS,
      };
    })
  );
  api.get(
    '/system/backup',
    requirePermission('system:manage'),
    wrap(async (req, res) => {
      const data = await backup.exportAll();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="jpm-backup-${todayISO()}.json"`);
      res.send(JSON.stringify(data, null, 2));
    })
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
    if (config.ON_HOSTED_PLATFORM) {
      console.error('  This app is running on a hosting platform, so settings come from the service, not from a .env file.');
      console.error('  Check, in the hosting dashboard (Render: your service -> Environment):');
      console.error('   - MONGODB_URI is set to the Atlas connection string (with the real user name and password)');
      console.error(`   - MONGODB_DB is set (currently "${config.MONGODB_DB}")`);
      console.error('  And in MongoDB Atlas -> Network Access, allow 0.0.0.0/0');
      console.error('  (hosting platforms have no fixed IP address, so a single-address rule blocks them).\n');
    } else {
      console.error('  Things to check:');
      console.error('   - there is a .env file next to server.js (copy .env.example and fill it in)');
      console.error('   - .env has the correct MONGODB_URI (user name, password, cluster)');
      console.error('   - in MongoDB Atlas, Network Access allows this computer’s IP address');
      console.error('   - this computer is online\n');
    }
    process.exit(1);
  }

  const admin = await users.ensureDefaultAdmin();
  let sample = null;
  if (info.isNew && config.SEED_SAMPLE_DATA) {
    sample = await seedSampleData();
    console.log(`[setup] Added ${sample.entries} sample suspense entries and ${sample.users.length} sample employee logins.`);
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
      console.log(`  First-time admin login  ->  Employee ID: ${admin.username}   Password: ${admin.password}`);
      console.log('  (You will be asked to set a new password after the first login.)');
    }
    if (sample && sample.users.length) {
      console.log('');
      console.log('  Sample employee logins (each must set a new password at first login):');
      sample.users.forEach((u) => console.log(`    ${u.username.padEnd(10)} ${u.role.padEnd(7)} password: ${u.password}`));
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
