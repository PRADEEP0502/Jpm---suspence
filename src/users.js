'use strict';

/**
 * Entry/Admin login accounts. Dashboard viewers need no account.
 *   ADMIN - everything, plus user management, reopen, soft delete/restore
 *   ENTRY - add, edit, close entries
 */

const db = require('./db');
const audit = require('./audit');
const auth = require('./auth');
const config = require('./config');
const { HttpError, cleanText } = require('./util');

const ROLES = ['ADMIN', 'ENTRY'];

function mapUser(doc) {
  return {
    id: String(doc._id),
    username: doc.username,
    displayName: doc.displayName,
    role: doc.role,
    isActive: !!doc.isActive,
    mustChangePassword: !!doc.mustChangePassword,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

async function listUsers() {
  const docs = await db.collections.users().find({}).sort({ isActive: -1, role: 1, displayName: 1 }).toArray();
  return docs.map(mapUser);
}

async function findUser(id) {
  const _id = db.toObjectId(id);
  const doc = _id ? await db.collections.users().findOne({ _id }) : null;
  if (!doc) throw new HttpError(404, 'User not found.');
  return doc;
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

async function activeAdminCount(excludeId = null) {
  const filter = { role: 'ADMIN', isActive: true };
  if (excludeId) filter._id = { $ne: db.toObjectId(excludeId) };
  return db.collections.users().countDocuments(filter);
}

async function createUser(body, actor, { mustChangePassword = true } = {}) {
  const displayName = validateDisplayName(body.displayName);
  const username = String(body.username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
    throw new HttpError(400, 'Login ID must be 3-30 characters: letters, numbers, dot, dash or underscore.', {
      field: 'username',
    });
  }
  const role = validateRole(body.role);
  auth.validateNewPassword(body.password, 'password');

  const doc = {
    username,
    usernameLower: username.toLowerCase(),
    displayName,
    role,
    passwordHash: auth.hashPassword(body.password),
    mustChangePassword: !!mustChangePassword,
    isActive: true,
    createdAt: new Date(),
    updatedAt: null,
  };
  let insertedId;
  try {
    ({ insertedId } = await db.collections.users().insertOne(doc));
  } catch (err) {
    if (err && err.code === 11000) throw new HttpError(409, 'This login ID is already in use.', { field: 'username' });
    throw err;
  }
  await audit.logAction({
    action: 'USER_CREATE',
    details: { userId: String(insertedId), username, displayName, role },
    user: actor,
  });
  return mapUser({ ...doc, _id: insertedId });
}

async function updateUser(id, body, actor) {
  const doc = await findUser(id);
  const displayName = body.displayName !== undefined ? validateDisplayName(body.displayName) : doc.displayName;
  const role = body.role !== undefined ? validateRole(body.role) : doc.role;
  const isActive = body.isActive !== undefined ? !!body.isActive : !!doc.isActive;

  if (actor && actor.id === String(doc._id)) {
    if (role !== doc.role) throw new HttpError(400, 'You cannot change your own role.', { field: 'role' });
    if (!isActive) throw new HttpError(400, 'You cannot deactivate your own login.');
  }
  const removesAdmin = doc.role === 'ADMIN' && doc.isActive && (role !== 'ADMIN' || !isActive);
  if (removesAdmin && (await activeAdminCount(doc._id)) === 0) {
    throw new HttpError(400, 'At least one active administrator is required.');
  }

  const changes = {};
  if (displayName !== doc.displayName) changes.displayName = { from: doc.displayName, to: displayName };
  if (role !== doc.role) changes.role = { from: doc.role, to: role };
  if (isActive !== !!doc.isActive) changes.isActive = { from: !!doc.isActive, to: isActive };
  if (Object.keys(changes).length === 0) return mapUser(doc);

  await db.collections.users().updateOne(
    { _id: doc._id },
    { $set: { displayName, role, isActive, updatedAt: new Date() } }
  );
  if (!isActive || changes.role) await auth.destroyAllSessionsForUser(doc._id);
  await audit.logAction({
    action: 'USER_UPDATE',
    details: { userId: String(doc._id), username: doc.username, changes },
    user: actor,
  });
  return mapUser(await db.collections.users().findOne({ _id: doc._id }));
}

async function resetPassword(id, body, actor) {
  const doc = await findUser(id);
  auth.validateNewPassword(body.password, 'password');
  await db.collections.users().updateOne(
    { _id: doc._id },
    { $set: { passwordHash: auth.hashPassword(body.password), mustChangePassword: true, updatedAt: new Date() } }
  );
  await auth.destroyAllSessionsForUser(doc._id);
  await audit.logAction({
    action: 'USER_PASSWORD_RESET',
    details: { userId: String(doc._id), username: doc.username },
    user: actor,
  });
  return mapUser(await db.collections.users().findOne({ _id: doc._id }));
}

/** First run: create the initial administrator login. */
async function ensureDefaultAdmin() {
  if ((await db.collections.users().countDocuments({}, { limit: 1 })) > 0) return null;
  const username = config.ADMIN_USERNAME;
  const password = config.ADMIN_PASSWORD;
  await createUser({ displayName: 'Admin', username, password, role: 'ADMIN' }, null, { mustChangePassword: true });
  return { username, password };
}

module.exports = { listUsers, createUser, updateUser, resetPassword, ensureDefaultAdmin };
