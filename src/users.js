'use strict';

/**
 * Logins. Everyone who uses the system has one.
 *
 *   NORMAL  sees only the records of money given to them, view only
 *   ENTRY   sees every record and can add, edit and record returns
 *   ADMIN   full access, including users, roles and settings
 *   MD      full access, including users, roles and settings
 *
 * A login's "name" is also the name staff pick in "Given To". Names are unique among logins,
 * so records can be linked to the right person without any guessing.
 */

const db = require('./db');
const audit = require('./audit');
const auth = require('./auth');
const config = require('./config');
const permissions = require('./permissions');
const { HttpError, cleanText } = require('./util');

const ROLES = permissions.ROLES;
const FULL_ACCESS_ROLES = ['ADMIN', 'MD'];

function mapUser(doc) {
  const role = permissions.isRole(doc.role) ? doc.role : 'NORMAL';
  return {
    id: String(doc._id),
    username: doc.username,
    displayName: doc.displayName,
    role,
    roleLabel: permissions.ROLE_LABELS[role],
    isActive: !!doc.isActive,
    mustChangePassword: !!doc.mustChangePassword,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

async function listUsers() {
  const docs = await db.collections.users().find({}).toArray();
  const order = Object.fromEntries(ROLES.map((r, i) => [r, ROLES.length - i]));
  docs.sort(
    (a, b) =>
      Number(!!b.isActive) - Number(!!a.isActive) ||
      (order[b.role] || 0) - (order[a.role] || 0) ||
      String(a.displayName).localeCompare(String(b.displayName), 'en', { sensitivity: 'base' })
  );
  return docs.map(mapUser);
}

/** People that can be picked in "Given To": the active logins, by name. */
async function employeeNames() {
  const docs = await db.collections.users().find({ isActive: true }).project({ displayName: 1, username: 1 }).toArray();
  return docs
    .map((d) => ({ name: d.displayName, employeeId: d.username }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The login (if any) whose name matches a "Given To" name. */
async function findByName(name) {
  return db.collections.users().findOne({ displayNameLower: String(name).toLowerCase() });
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

async function ensureNameIsFree(name, exceptId = null) {
  const filter = { displayNameLower: name.toLowerCase() };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await db.collections.users().findOne(filter, { projection: { _id: 1 } })) {
    throw new HttpError(409, 'Another login already uses this name. Names must be different so records go to the right person.', {
      field: 'displayName',
    });
  }
}

async function activeFullAccessCount(excludeId = null) {
  const filter = { role: { $in: FULL_ACCESS_ROLES }, isActive: true };
  if (excludeId) filter._id = { $ne: db.toObjectId(excludeId) };
  return db.collections.users().countDocuments(filter);
}

/** Point every record that was given to this person's name at their login. */
async function linkEntriesToUser(user) {
  const result = await db.collections.entries().updateMany(
    { whomLower: user.displayNameLower },
    { $set: { givenToUserId: user._id } }
  );
  return result.modifiedCount;
}

async function createUser(body, actor, { mustChangePassword = true } = {}) {
  const displayName = validateDisplayName(body.displayName);
  const username = String(body.username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
    throw new HttpError(400, 'Employee ID must be 3-30 characters: letters, numbers, dot, dash or underscore.', {
      field: 'username',
    });
  }
  const role = validateRole(body.role || 'NORMAL');
  auth.validateNewPassword(body.password, 'password');
  await ensureNameIsFree(displayName);

  const doc = {
    username,
    usernameLower: username.toLowerCase(),
    displayName,
    displayNameLower: displayName.toLowerCase(),
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
    if (err && err.code === 11000) {
      const which = /displayNameLower/.test(err.message) ? 'displayName' : 'username';
      throw new HttpError(
        409,
        which === 'username' ? 'This Employee ID is already in use.' : 'Another login already uses this name.',
        { field: which }
      );
    }
    throw err;
  }
  const linked = await linkEntriesToUser({ ...doc, _id: insertedId });
  await audit.logAction({
    action: 'USER_CREATE',
    details: { userId: String(insertedId), username, displayName, role, linkedRecords: linked },
    user: actor,
  });
  return { ...mapUser({ ...doc, _id: insertedId }), linkedRecords: linked };
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
  const losesFullAccess = FULL_ACCESS_ROLES.includes(doc.role) && doc.isActive && (!FULL_ACCESS_ROLES.includes(role) || !isActive);
  if (losesFullAccess && (await activeFullAccessCount(doc._id)) === 0) {
    throw new HttpError(400, 'At least one active Admin or MD is required.');
  }
  if (displayName.toLowerCase() !== doc.displayNameLower) await ensureNameIsFree(displayName, doc._id);

  const changes = {};
  if (displayName !== doc.displayName) changes.displayName = { from: doc.displayName, to: displayName };
  if (role !== doc.role) changes.role = { from: doc.role, to: role };
  if (isActive !== !!doc.isActive) changes.isActive = { from: !!doc.isActive, to: isActive };
  if (Object.keys(changes).length === 0) return mapUser(doc);

  await db.collections.users().updateOne(
    { _id: doc._id },
    { $set: { displayName, displayNameLower: displayName.toLowerCase(), role, isActive, updatedAt: new Date() } }
  );
  // A new role or a disabled login takes effect at once: the person is signed out everywhere.
  if (!isActive || changes.role) await auth.destroyAllSessionsForUser(doc._id);
  if (changes.displayName) await linkEntriesToUser({ _id: doc._id, displayNameLower: displayName.toLowerCase() });
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

/** How many logins each role has (for the Permissions and Settings screens). */
async function roleCounts() {
  const counts = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (const u of await db.collections.users().find({ isActive: true }).project({ role: 1 }).toArray()) {
    if (counts[u.role] !== undefined) counts[u.role] += 1;
  }
  return counts;
}

/** First run: create the initial administrator login. */
async function ensureDefaultAdmin() {
  if ((await db.collections.users().countDocuments({}, { limit: 1 })) > 0) return null;
  const username = config.ADMIN_USERNAME;
  const password = config.ADMIN_PASSWORD;
  await createUser({ displayName: 'Admin', username, password, role: 'ADMIN' }, null, { mustChangePassword: true });
  return { username, password };
}

module.exports = {
  listUsers,
  employeeNames,
  findByName,
  createUser,
  updateUser,
  resetPassword,
  roleCounts,
  ensureDefaultAdmin,
};
