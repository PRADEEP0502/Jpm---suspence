'use strict';

const db = require('./db');

async function logAction({ entryId = null, action, details = null, user }) {
  await db.collections.auditLog().insertOne({
    entryId: entryId ? db.toObjectId(entryId) : null,
    action,
    details,
    performedBy: user ? user.displayName : 'System',
    performedByUserId: user ? user.id : null,
    performedAt: new Date(),
  });
}

async function historyForEntry(entryId) {
  const _id = db.toObjectId(entryId);
  if (!_id) return [];
  const rows = await db.collections.auditLog().find({ entryId: _id }).sort({ _id: 1 }).toArray();
  return rows.map((r) => ({
    id: String(r._id),
    action: r.action,
    details: r.details || null,
    performedBy: r.performedBy,
    performedAt: r.performedAt,
  }));
}

module.exports = { logAction, historyForEntry };
