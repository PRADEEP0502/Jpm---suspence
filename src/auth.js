'use strict';

/**
 * Login, sessions and permission checks.
 *  - Passwords: scrypt with a per-user random salt.
 *  - Sessions: random token in an HttpOnly cookie; only its SHA-256 hash is stored.
 *  - Repeated failed logins for the same login ID are temporarily locked.
 */

const crypto = require('crypto');
const db = require('./db');
const { HttpError, nowTimestamp } = require('./util');

const COOKIE_NAME = 'jpm_sid';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';

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
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: !!row.must_change_password,
  };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  db.transaction(() => {
    db.run('DELETE FROM sessions WHERE expires_at < @now', { now: now.toISOString() });
    db.run(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (@hash, @userId, @created, @expires)`,
      { hash: sha256(token), userId, created: now.toISOString(), expires: expires.toISOString() }
    );
  });
  setSessionCookie(res, token, SESSION_HOURS * 3600);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = @hash', { hash: sha256(token) });
  setSessionCookie(res, '', 0);
}

/** Log a user out everywhere (optionally keeping the session making this request). */
function destroyAllSessionsForUser(userId, keepReq) {
  const keep = keepReq ? parseCookies(keepReq.headers.cookie)[COOKIE_NAME] : null;
  db.run('DELETE FROM sessions WHERE user_id = @userId AND token_hash != @keep', {
    userId,
    keep: keep ? sha256(keep) : '',
  });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function login(req, res, username, password) {
  const loginId = String(username || '').trim();
  if (!loginId || !password) throw new HttpError(400, 'Enter your login ID and password.');

  const key = `${req.ip}|${loginId.toLowerCase()}`;
  const record = failedLogins.get(key);
  if (record && record.lockedUntil && record.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    throw new HttpError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  const row = db.get('SELECT * FROM users WHERE username = @u COLLATE NOCASE', { u: loginId });
  let ok = false;
  if (row) ok = verifyPassword(String(password), row.password_hash);
  else verifyPassword(String(password), DUMMY_HASH);

  if (!ok) {
    const prevCount = record && !record.lockedUntil ? record.count : 0;
    const next = { count: prevCount + 1, lockedUntil: null };
    if (next.count >= MAX_FAILED_ATTEMPTS) next.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
    failedLogins.set(key, next);
    throw new HttpError(401, 'Invalid login ID or password.');
  }
  if (!row.is_active) {
    throw new HttpError(403, 'This login has been deactivated. Contact the administrator.');
  }

  failedLogins.delete(key);
  createSession(res, row.id);
  return toPublicUser(row);
}

function changePassword(req, currentPassword, newPassword) {
  const row = db.get('SELECT * FROM users WHERE id = @id', { id: req.user.id });
  if (!row || !verifyPassword(String(currentPassword || ''), row.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect.', { field: 'currentPassword' });
  }
  validateNewPassword(newPassword);
  if (currentPassword === newPassword) {
    throw new HttpError(400, 'New password must be different from the current password.', { field: 'newPassword' });
  }
  db.transaction(() => {
    db.run(`UPDATE users SET password_hash = @hash, must_change_password = 0, updated_at = @now WHERE id = @id`, {
      hash: hashPassword(newPassword),
      now: nowTimestamp(),
      id: row.id,
    });
    destroyAllSessionsForUser(row.id, req);
  });
  return toPublicUser(db.get('SELECT * FROM users WHERE id = @id', { id: row.id }));
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const row = db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = @hash AND s.expires_at > @now AND u.is_active = 1`,
      { hash: sha256(token), now: new Date().toISOString() }
    );
    if (row) req.user = toPublicUser(row);
  }
  next();
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

function requireAdmin(req, res, next) {
  requireLogin(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'ADMIN') return next(new HttpError(403, 'Only an administrator can do this.'));
    next();
  });
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
  requireAdmin,
  requireJsonForWrites,
};
