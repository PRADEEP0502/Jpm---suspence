'use strict';

/**
 * Login, sessions and permission checks.
 *  - Passwords: scrypt with a per-user random salt.
 *  - Sessions: random token in an HttpOnly cookie; only its SHA-256 hash is stored, and MongoDB
 *    removes each session automatically when it expires.
 *  - Repeated failed logins for the same login ID are temporarily locked.
 */

const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { HttpError } = require('./util');
const permissions = require('./permissions');

const COOKIE_NAME = 'jpm_sid';
const SESSION_HOURS = config.SESSION_HOURS;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const failedLogins = new Map(); // key: ip|username -> { count, lockedUntil }

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$');
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used to keep response time similar when the login ID does not exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

function validateNewPassword(password, field = 'newPassword') {
  if (typeof password !== 'string' || password.length < 6) {
    throw new HttpError(400, 'Password must be at least 6 characters.', { field });
  }
  if (password.length > 128) {
    throw new HttpError(400, 'Password is too long.', { field });
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch (_) {
      out[key] = val;
    }
  });
  return out;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (config.COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function toPublicUser(doc) {
  const role = permissions.isRole(doc.role) ? doc.role : 'NORMAL';
  return {
    id: String(doc._id),
    username: doc.username,
    displayName: doc.displayName,
    role,
    roleLabel: permissions.ROLE_LABELS[role],
    // Same list the server enforces; the browser only uses it to decide what to show.
    permissions: permissions.permissionsFor(role),
    home: permissions.HOME_FOR_ROLE[role],
    mustChangePassword: !!doc.mustChangePassword,
  };
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  await db.collections.sessions().insertOne({
    _id: sha256(token),
    userId: db.toObjectId(userId),
    createdAt: now,
    expiresAt,
  });
  setSessionCookie(res, token, SESSION_HOURS * 3600);
}

async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) await db.collections.sessions().deleteOne({ _id: sha256(token) });
  setSessionCookie(res, '', 0);
}

/** Log a user out everywhere (optionally keeping the session making this request). */
async function destroyAllSessionsForUser(userId, keepReq) {
  const keep = keepReq ? parseCookies(keepReq.headers.cookie)[COOKIE_NAME] : null;
  await db.collections.sessions().deleteMany({
    userId: db.toObjectId(userId),
    _id: { $ne: keep ? sha256(keep) : '' },
  });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function login(req, res, username, password) {
  const loginId = String(username || '').trim();
  if (!loginId || !password) throw new HttpError(400, 'Enter your login ID and password.');

  const key = `${req.ip}|${loginId.toLowerCase()}`;
  const record = failedLogins.get(key);
  if (record && record.lockedUntil && record.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  const doc = await db.collections.users().findOne({ usernameLower: loginId.toLowerCase() });
  let ok = false;
  if (doc) ok = verifyPassword(String(password), doc.passwordHash);
  else verifyPassword(String(password), DUMMY_HASH);

  if (!ok) {
    const prevCount = record && !record.lockedUntil ? record.count : 0;
    const next = { count: prevCount + 1, lockedUntil: null };
    if (next.count >= MAX_FAILED_ATTEMPTS) next.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
    failedLogins.set(key, next);
    throw new HttpError(401, 'Invalid login ID or password.');
  }
  if (!doc.isActive) {
    throw new HttpError(403, 'This login has been deactivated. Contact the administrator.');
  }

  failedLogins.delete(key);
  await createSession(res, doc._id);
  return toPublicUser(doc);
}

async function changePassword(req, currentPassword, newPassword) {
  const doc = await db.collections.users().findOne({ _id: db.toObjectId(req.user.id) });
  if (!doc || !verifyPassword(String(currentPassword || ''), doc.passwordHash)) {
    throw new HttpError(400, 'Current password is incorrect.', { field: 'currentPassword' });
  }
  validateNewPassword(newPassword);
  if (currentPassword === newPassword) {
    throw new HttpError(400, 'New password must be different from the current password.', { field: 'newPassword' });
  }
  await db.collections.users().updateOne(
    { _id: doc._id },
    { $set: { passwordHash: hashPassword(newPassword), mustChangePassword: false, updatedAt: new Date() } }
  );
  await destroyAllSessionsForUser(doc._id, req);
  return toPublicUser(await db.collections.users().findOne({ _id: doc._id }));
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

async function loadUser(req, _res, next) {
  req.user = null;
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      const session = await db.collections.sessions().findOne({ _id: sha256(token), expiresAt: { $gt: new Date() } });
      if (session) {
        const user = await db.collections.users().findOne({ _id: session.userId, isActive: true });
        if (user) req.user = toPublicUser(user);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Logged in, active, and not waiting on a forced password change. */
function requireLogin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue.', { code: 'LOGIN_REQUIRED' }));
  if (req.user.mustChangePassword) {
    return next(
      new HttpError(403, 'Please change your password before continuing.', { code: 'PASSWORD_CHANGE_REQUIRED' })
    );
  }
  next();
}

/**
 * Server-side permission check. Every route that reads or changes protected data uses this,
 * so a user who calls the API directly gets exactly the same answer as one using the screens.
 */
function requirePermission(...needed) {
  return (req, res, next) => {
    requireLogin(req, res, (err) => {
      if (err) return next(err);
      if (needed.some((p) => permissions.can(req.user, p))) return next();
      next(new HttpError(403, 'You do not have permission to do this.', { code: 'FORBIDDEN' }));
    });
  };
}

/**
 * State-changing requests must be JSON. Browsers cannot send cross-site JSON
 * without a CORS preflight, which (together with SameSite cookies) blocks CSRF.
 */
function requireJsonForWrites(req, _res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return next(new HttpError(415, 'Requests must be sent as JSON.'));
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  validateNewPassword,
  login,
  changePassword,
  destroySession,
  destroyAllSessionsForUser,
  loadUser,
  requireLogin,
  requirePermission,
  requireJsonForWrites,
  toPublicUser,
};
