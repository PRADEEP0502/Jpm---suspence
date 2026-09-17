'use strict';

/**
 * Entry/Admin login accounts. Dashboard viewers need no account.
 *   ADMIN - everything, plus user management, reopen, soft delete/restore
 *   ENTRY - add, edit, close entries
 */

const db = require('./db');
const audit = require('./audit');
const auth = require('./auth');
const { HttpError, cleanText, nowTimestamp } = require('./util');

const ROLES = ['ADMIN', 'ENTRY'];

function mapUser(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    isActive: !!r.is_active,
    mustChangePassword: !!r.must_change_password,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function listUsers() {
  return db.all('SELECT * FROM users ORDER BY is_active DESC, role, display_name COLLATE NOCASE').map(mapUser);
}

function findUser(id) {
  const row = db.get('SELECT * FROM users WHERE id = @id', { id: Number(id) || 0 });
  if (!row) throw new HttpError(404, 'User not found.');
  return row;
}

function validateDisplayName(value) {
  const name = cleanText(value);
  if (!name) throw new HttpError(400, 'Enter the person’s name.', { field: 'displayName' });
  if (name.length > 60) throw new HttpError(400, 'Name is too long (max 60 characters).', { field: 'displayName' });
  return name;
}

function validateRole(value) {
  const role = String(value || '').toUpperCase();
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a valid role.', { field: 'role' });
  return role;
}

function activeAdminCount(excludeId = 0) {
  return db.get(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1 AND id != @excludeId",
    { excludeId }
  ).n;
}

function createUser(body, actor, { mustChangePassword = true } = {}) {
  const displayName = validateDisplayName(body.displayName);
  const username = String(body.username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
    throw new HttpError(400, 'Login ID must be 3-30 characters: letters, numbers, dot, dash or underscore.', {
      field: 'username',
    });
  }
  const role = validateRole(body.role);
  auth.validateNewPassword(body.password, 'password');

  if (db.get('SELECT id FROM users WHERE username = @u COLLATE NOCASE', { u: username })) {
    throw new HttpError(409, 'This login ID is already in use.', { field: 'username' });
  }

  return db.transaction(() => {
    const { lastId } = db.run(
      `INSERT INTO users (username, display_name, role, password_hash, must_change_password, is_active, created_at)
       VALUES (@username, @displayName, @role, @hash, @mustChange, 1, @now)`,
      {
        username,
        displayName,
        role,
        hash: auth.hashPassword(body.password),
        mustChange: mustChangePassword ? 1 : 0,
        now: nowTimestamp(),
      }
    );
    audit.logAction({ action: 'USER_CREATE', details: { userId: lastId, username, displayName, role }, user: actor });
    return mapUser(findUser(lastId));
  });
}

function updateUser(id, body, actor) {
  const row = findUser(id);
  const displayName = body.displayName !== undefined ? validateDisplayName(body.displayName) : row.display_name;
  const role = body.role !== undefined ? validateRole(body.role) : row.role;
  const isActive = body.isActive !== undefined ? (body.isActive ? 1 : 0) : row.is_active;

  if (actor && actor.id === row.id) {
    if (role !== row.role) throw new HttpError(400, 'You cannot change your own role.', { field: 'role' });
    if (!isActive) throw new HttpError(400, 'You cannot deactivate your own login.');
  }
  const removesAdmin = row.role === 'ADMIN' && row.is_active && (role !== 'ADMIN' || !isActive);
  if (removesAdmin && activeAdminCount(row.id) === 0) {
    throw new HttpError(400, 'At least one active administrator is required.');
  }

  const changes = {};
  if (displayName !== row.display_name) changes.displayName = { from: row.display_name, to: displayName };
  if (role !== row.role) changes.role = { from: row.role, to: role };
  if (isActive !== row.is_active) changes.isActive = { from: !!row.is_active, to: !!isActive };
  if (Object.keys(changes).length === 0) return mapUser(row);

  return db.transaction(() => {
    db.run(
      `UPDATE users SET display_name = @displayName, role = @role, is_active = @isActive, updated_at = @now
        WHERE id = @id`,
      { displayName, role, isActive, now: nowTimestamp(), id: row.id }
    );
    if (!isActive || changes.role) auth.destroyAllSessionsForUser(row.id);
    audit.logAction({
      action: 'USER_UPDATE',
      details: { userId: row.id, username: row.username, changes },
      user: actor,
    });
    return mapUser(findUser(row.id));
  });
}

function resetPassword(id, body, actor) {
  const row = findUser(id);
  auth.validateNewPassword(body.password, 'password');
  return db.transaction(() => {
    db.run(
      `UPDATE users SET password_hash = @hash, must_change_password = 1, updated_at = @now WHERE id = @id`,
      { hash: auth.hashPassword(body.password), now: nowTimestamp(), id: row.id }
    );
    auth.destroyAllSessionsForUser(row.id);
    audit.logAction({
      action: 'USER_PASSWORD_RESET',
      details: { userId: row.id, username: row.username },
      user: actor,
    });
    return mapUser(findUser(row.id));
  });
}

/** First run: create the initial administrator login. */
function ensureDefaultAdmin() {
  const { n } = db.get('SELECT COUNT(*) AS n FROM users');
  if (n > 0) return null;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';
  createUser({ displayName: 'Admin', username, password, role: 'ADMIN' }, null, { mustChangePassword: true });
  return { username, password };
}

module.exports = { listUsers, createUser, updateUser, resetPassword, ensureDefaultAdmin };
