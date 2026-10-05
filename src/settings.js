'use strict';

/**
 * App-wide settings changed from the Settings page (Admin / MD).
 *
 * receiverAssignee: the employee every Money Receiver's Assign goes to automatically
 * (e.g. Gomathi). Money Receivers do not choose; staff still choose freely.
 */

const db = require('./db');

const settings = () => db.getDb().collection('settings');

async function receiverAssignee() {
  const doc = await settings().findOne({ _id: 'assign' });
  if (!doc || !doc.receiverAssigneeId) return null;
  const user = await db.collections.users().findOne({ _id: doc.receiverAssigneeId, isActive: true });
  return user || null;
}

async function setReceiverAssignee(userId) {
  const _id = userId ? db.toObjectId(userId) : null;
  await settings().updateOne({ _id: 'assign' }, { $set: { receiverAssigneeId: _id, updatedAt: new Date() } }, { upsert: true });
  return receiverAssignee();
}

/** First start after this feature: default to the login named Gomathi, if there is one. */
async function ensureDefaults() {
  if (await settings().findOne({ _id: 'assign' })) return;
  const gomathi = await db.collections.users().findOne({ displayNameLower: 'gomathi', isActive: true });
  if (gomathi) await setReceiverAssignee(String(gomathi._id));
}

module.exports = { receiverAssignee, setReceiverAssignee, ensureDefaults };
