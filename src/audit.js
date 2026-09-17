'use strict';

const db = require('./db');
const { nowTimestamp } = require('./util');

function logAction({ entryId = null, action, details = null, user }) {
  db.run(
    `INSERT INTO audit_log (entry_id, action, details, performed_by, performed_by_user_id, performed_at)
     VALUES (@entryId, @action, @details, @by, @byId, @at)`,
    {
      entryId,
      action,
      details: details ? JSON.stringify(details) : null,
      by: user ? user.displayName : 'System',
      byId: user ? user.id : null,
      at: nowTimestamp(),
    }
  );
}

function historyForEntry(entryId) {
  return db
    .all(
      `SELECT id, action, details, performed_by, performed_at
         FROM audit_log WHERE entry_id = @entryId ORDER BY id`,
      { entryId }
    )
    .map((r) => ({
      id: r.id,
      action: r.action,
      details: r.details ? JSON.parse(r.details) : null,
      performedBy: r.performed_by,
      performedAt: r.performed_at,
    }));
}

module.exports = { logAction, historyForEntry };
