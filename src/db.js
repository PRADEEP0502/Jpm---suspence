'use strict';

/**
 * MongoDB storage (MongoDB Atlas, or any MongoDB server).
 *
 * Collections
 *   entries    one document per suspense entry (permanent SRN, amounts in paise)
 *   users      Entry/Admin logins
 *   sessions   active logins; MongoDB removes them automatically when they expire
 *   counters   the SRN running number
 *   audit_log  change history
 *
 * The connection string lives in .env and is never committed. See src/config.js.
 */

const dns = require('dns');
const { MongoClient, ObjectId } = require('mongodb');
const config = require('./config');

let client = null;
let db = null;

const collections = {
  entries: () => db.collection('entries'),
  users: () => db.collection('users'),
  sessions: () => db.collection('sessions'),
  counters: () => db.collection('counters'),
  auditLog: () => db.collection('audit_log'),
};

const isDnsFailure = (err) =>
  /querySrv|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ESERVFAIL|getaddrinfo/i.test(`${err.code || ''} ${err.message || ''}`);

async function connect(uri) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 20000, retryWrites: true });
  await c.connect();
  await c.db(config.MONGODB_DB).command({ ping: 1 });
  return c;
}

async function openDatabase() {
  if (!config.MONGODB_URI) {
    throw new Error(
      'No database connection string. Create a .env file next to server.js containing:\n' +
        '  MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority\n' +
        '(copy .env.example to .env and fill in your details)'
    );
  }

  try {
    client = await connect(config.MONGODB_URI);
  } catch (err) {
    if (!isDnsFailure(err) || !config.DNS_FALLBACK.length) throw err;
    // The system resolver could not look up the cluster; try public DNS servers instead.
    console.warn('[db] System DNS could not find the cluster; retrying via', config.DNS_FALLBACK.join(', '));
    dns.setServers([...config.DNS_FALLBACK, ...dns.getServers()]);
    client = await connect(config.MONGODB_URI);
  }

  db = client.db(config.MONGODB_DB);
  await ensureIndexes();
  const isNew =
    (await collections.entries().countDocuments({}, { limit: 1 })) === 0 &&
    (await collections.users().countDocuments({}, { limit: 1 })) === 0;
  return { isNew, name: db.databaseName, host: hostLabel() };
}

/** Cluster host for the start-up message (never includes the password). */
function hostLabel() {
  const m = /@([^/?]+)/.exec(config.MONGODB_URI);
  return m ? m[1] : 'MongoDB';
}

async function ensureIndexes() {
  await collections.entries().createIndexes([
    { key: { srn: 1 }, unique: true, name: 'srn_unique' },
    { key: { srnNo: 1 }, unique: true, name: 'srn_no_unique' },
    { key: { isDeleted: 1, status: 1 }, name: 'state' },
    { key: { entryDate: 1 }, name: 'entry_date' },
    { key: { whomLower: 1 }, name: 'whom' },
    { key: { particularsLower: 1 }, name: 'particulars' },
  ]);
  await collections.users().createIndexes([{ key: { usernameLower: 1 }, unique: true, name: 'username_unique' }]);
  await collections.sessions().createIndexes([
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'session_expiry' },
    { key: { userId: 1 }, name: 'session_user' },
  ]);
  await collections.auditLog().createIndexes([{ key: { entryId: 1, _id: 1 }, name: 'audit_entry' }]);
}

async function closeDatabase() {
  if (client) await client.close();
  client = null;
  db = null;
}

/** Next SRN number: atomic, so two people adding at the same moment can never get the same one. */
async function nextSrnNumber() {
  const result = await collections
    .counters()
    .findOneAndUpdate({ _id: 'srn' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  const doc = result && result.value ? result.value : result;
  return doc.seq;
}

/** The number the next new entry would get, without using it up (for the Add form preview). */
async function peekSrnNumber() {
  const doc = await collections.counters().findOne({ _id: 'srn' });
  return (doc ? doc.seq : 0) + 1;
}

/** Keep the counter ahead of every SRN already stored (used after an import/restore). */
async function syncSrnCounter() {
  const [highest] = await collections.entries().find({}).sort({ srnNo: -1 }).limit(1).toArray();
  if (!highest) return;
  await collections.counters().updateOne({ _id: 'srn' }, { $max: { seq: highest.srnNo } }, { upsert: true });
}

const toObjectId = (id) => {
  if (id instanceof ObjectId) return id;
  return ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null;
};

module.exports = {
  openDatabase,
  closeDatabase,
  collections,
  nextSrnNumber,
  peekSrnNumber,
  syncSrnCounter,
  toObjectId,
  ObjectId,
  getDb: () => db,
};
