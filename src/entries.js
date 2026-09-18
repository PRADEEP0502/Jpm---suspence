'use strict';

/**
 * Suspense entry lifecycle and all dashboard calculations (MongoDB).
 *
 * Every entry gets a permanent SRN (Suspense Reference Number: SRN-001, SRN-002, ...) when it is
 * created. The number comes from an atomic counter, is never reused, and never changes on edit or close.
 *
 *   OPEN   --close-->  CLOSED        (entry user or admin; closed date = today, automatic)
 *   CLOSED --reopen--> OPEN          (admin only, reason required, audited)
 *   any    --delete--> deleted flag  (admin only, soft delete, reason required, restorable)
 *
 * Nothing is ever physically removed from the entries collection.
 */

const db = require('./db');
const audit = require('./audit');
const {
  AGE_BUCKETS,
  DEFAULT_PARTICULARS,
  MAX_AMOUNT_PAISE,
  HttpError,
  todayISO,
  isValidISODate,
  bucketForAge,
  formatSrn,
  parseSrn,
  cleanText,
  parseAmountToPaise,
  escapeRegex,
  daysBetween,
} = require('./util');

const LIST_STATUSES = ['OPEN', 'CLOSED', 'ALL', 'DELETED'];

/** Age in whole days: (closed date, or today while still open) - the date the amount was given. */
function ageOf(doc, today) {
  return Math.max(0, daysBetween(doc.entryDate, doc.closedDate || today));
}

function mapEntry(doc, today) {
  const ageDays = ageOf(doc, today);
  const bucket = bucketForAge(ageDays);
  return {
    id: String(doc._id),
    srnNo: doc.srnNo,
    srn: doc.srn,
    entryDate: doc.entryDate,
    whom: doc.whom,
    particulars: doc.particulars,
    amountPaise: doc.amountPaise,
    remark: doc.remark ?? null,
    status: doc.status,
    ageDays,
    ageBucket: bucket.key,
    ageLevel: bucket.level,
    ageLevelLabel: bucket.levelLabel,
    closedDate: doc.closedDate ?? null,
    closedAt: doc.closedAt ?? null,
    closedBy: doc.closedBy ?? null,
    closingRemark: doc.closingRemark ?? null,
    isDeleted: !!doc.isDeleted,
    deletedAt: doc.deletedAt ?? null,
    deletedBy: doc.deletedBy ?? null,
    deleteReason: doc.deleteReason ?? null,
    version: doc.version,
    createdAt: doc.createdAt ?? null,
    createdBy: doc.createdBy ?? null,
    updatedAt: doc.updatedAt ?? null,
    updatedBy: doc.updatedBy ?? null,
  };
}

/** findOneAndUpdate returns either the document or { value } depending on driver version. */
const updatedDoc = (result) => (result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result);

async function findDoc(id) {
  const _id = db.toObjectId(id);
  if (!_id) return null;
  return db.collections.entries().findOne({ _id });
}

async function requireActiveDoc(id) {
  const doc = await findDoc(id);
  if (!doc || doc.isDeleted) throw new HttpError(404, 'Entry not found.');
  return doc;
}

function checkVersion(doc, version) {
  if (version === undefined || version === null || version === '') return;
  if (Number(version) !== doc.version) {
    throw new HttpError(
      409,
      `${doc.srn} was changed by someone else a moment ago. Please close this window and open the entry again.`,
      { code: 'VERSION_CONFLICT' }
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getEntry(id, { includeDeleted = false } = {}) {
  const doc = await findDoc(id);
  if (!doc || (doc.isDeleted && !includeDeleted)) return null;
  return mapEntry(doc, todayISO());
}

async function listEntries(query = {}) {
  const today = todayISO();
  const filter = {};

  const requested = String(query.status || 'ALL').toUpperCase();
  const status = LIST_STATUSES.includes(requested) ? requested : 'ALL';
  if (status === 'DELETED') {
    filter.isDeleted = true;
  } else {
    filter.isDeleted = false;
    if (status !== 'ALL') filter.status = status;
  }

  // One search box: SRN, name or particulars. "SRN-001", "srn 1" or "SRN001" find exactly that record.
  const q = cleanText(query.q);
  const srnNo = parseSrn(q);
  if (srnNo !== null) {
    filter.srnNo = srnNo;
  } else if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ srn: rx }, { whom: rx }, { particulars: rx }];
  }

  const whom = cleanText(query.whom);
  if (whom) filter.whomLower = whom.toLowerCase();

  const dateField = query.dateField === 'closed' ? 'closedDate' : 'entryDate';
  const dateRange = {};
  if (isValidISODate(query.dateFrom)) dateRange.$gte = query.dateFrom;
  if (isValidISODate(query.dateTo)) dateRange.$lte = query.dateTo;
  if (Object.keys(dateRange).length) filter[dateField] = dateRange;

  const amountRange = {};
  const amountMin = parseAmountToPaise(query.amountMin);
  if (query.amountMin && amountMin !== null) amountRange.$gte = amountMin;
  const amountMax = parseAmountToPaise(query.amountMax);
  if (query.amountMax && amountMax !== null) amountRange.$lte = amountMax;
  if (Object.keys(amountRange).length) filter.amountPaise = amountRange;

  const docs = await db.collections.entries().find(filter).sort({ srnNo: -1 }).toArray();
  let entries = docs.map((doc) => mapEntry(doc, today));

  // Age depends on today (open entries) or the closing date (closed ones), so it is applied here.
  const bucket = AGE_BUCKETS.find((b) => b.key === query.age);
  if (bucket) {
    entries = entries.filter((e) => e.ageDays >= bucket.min && (bucket.max === null || e.ageDays <= bucket.max));
  }

  const amountPaise = entries.reduce((sum, e) => sum + e.amountPaise, 0);
  return { today, status, entries, totals: { count: entries.length, amountPaise } };
}

/** Everything the dashboard needs, calculated from the live (non-deleted) entries. */
async function dashboardSummary() {
  const today = todayISO();
  const docs = await db.collections.entries().find({ isDeleted: false }).toArray();
  const entries = docs.map((doc) => mapEntry(doc, today));

  const blank = (name) => ({
    name,
    totalCount: 0,
    totalAmountPaise: 0,
    openCount: 0,
    openAmountPaise: 0,
    closedCount: 0,
    closedAmountPaise: 0,
    oldestOpenDays: null,
  });
  const cards = blank('ALL');
  const persons = new Map();
  const particulars = new Map();
  const aging = AGE_BUCKETS.map((b) => ({ ...b, count: 0, amountPaise: 0 }));

  const group = (map, name) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, blank(name));
    return map.get(key);
  };

  for (const e of entries) {
    for (const g of [cards, group(persons, e.whom), group(particulars, e.particulars)]) {
      g.totalCount += 1;
      g.totalAmountPaise += e.amountPaise;
      if (e.status === 'OPEN') {
        g.openCount += 1;
        g.openAmountPaise += e.amountPaise;
        g.oldestOpenDays = Math.max(g.oldestOpenDays ?? 0, e.ageDays);
      } else {
        g.closedCount += 1;
        g.closedAmountPaise += e.amountPaise;
      }
    }
    if (e.status === 'OPEN') {
      const b = aging.find((a) => a.key === e.ageBucket);
      b.count += 1;
      b.amountPaise += e.amountPaise;
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  delete cards.name;

  return {
    today,
    cards,
    aging,
    persons: [...persons.values()].sort(
      (a, b) => b.openAmountPaise - a.openAmountPaise || b.totalAmountPaise - a.totalAmountPaise || byName(a, b)
    ),
    particulars: [...particulars.values()].sort(
      (a, b) => b.totalAmountPaise - a.totalAmountPaise || b.openAmountPaise - a.openAmountPaise || byName(a, b)
    ),
  };
}

/** Names and particulars already in use, for type-ahead suggestions and the Given To filter. */
async function lookups() {
  const uniq = (values) => {
    const seen = new Map();
    values.forEach((v) => {
      const key = String(v).toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  };
  const entries = db.collections.entries();
  const [persons, used] = await Promise.all([
    entries.distinct('whom', { isDeleted: false }),
    entries.distinct('particulars', { isDeleted: false }),
  ]);
  return {
    persons: uniq(persons),
    suggestedParticulars: uniq([...DEFAULT_PARTICULARS, ...used]),
  };
}

/** SRN the next new entry will receive (shown read-only in the Add form). */
async function nextSrn() {
  return formatSrn(await db.peekSrnNumber());
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function validateEntryInput(body, today) {
  const entryDate = String(body.entryDate || '').trim();
  if (!isValidISODate(entryDate)) throw new HttpError(400, 'Enter a valid date.', { field: 'entryDate' });
  if (entryDate > today) throw new HttpError(400, 'Date cannot be in the future.', { field: 'entryDate' });
  if (entryDate < '2000-01-01') throw new HttpError(400, 'Date is too far in the past.', { field: 'entryDate' });

  const whom = cleanText(body.whom);
  if (!whom) throw new HttpError(400, 'Enter the name of the person the amount was given to.', { field: 'whom' });
  if (whom.length > 100) throw new HttpError(400, 'Name is too long (max 100 characters).', { field: 'whom' });

  const particulars = cleanText(body.particulars);
  if (!particulars) throw new HttpError(400, 'Enter what the amount was given for.', { field: 'particulars' });
  if (particulars.length > 150) {
    throw new HttpError(400, 'Particulars is too long (max 150 characters).', { field: 'particulars' });
  }

  const amountPaise = parseAmountToPaise(body.amount);
  if (amountPaise === null || amountPaise <= 0) {
    throw new HttpError(400, 'Enter a valid amount greater than zero (for example 500 or 1250.50).', {
      field: 'amount',
    });
  }
  if (amountPaise > MAX_AMOUNT_PAISE) throw new HttpError(400, 'Amount is too large.', { field: 'amount' });

  const remark = cleanText(body.remark);
  if (remark.length > 500) throw new HttpError(400, 'Remark is too long (max 500 characters).', { field: 'remark' });

  return { entryDate, whom, particulars, amountPaise, remark: remark || null };
}

/** Reuse the existing spelling of a name/particular so "ashok" and "Ashok" group together. */
async function canonicalSpelling(field, value, excludeId = null) {
  if (!['whom', 'particulars'].includes(field)) throw new Error('Invalid field');
  const filter = { [`${field}Lower`]: value.toLowerCase(), isDeleted: false };
  if (excludeId) filter._id = { $ne: excludeId };
  const doc = await db.collections.entries().find(filter).sort({ _id: 1 }).limit(1).next();
  if (doc) return doc[field];
  if (field === 'particulars') {
    const standard = DEFAULT_PARTICULARS.find((p) => p.toLowerCase() === value.toLowerCase());
    if (standard) return standard;
  }
  return value;
}

async function createEntry(body, user) {
  const input = validateEntryInput(body, todayISO());
  input.whom = await canonicalSpelling('whom', input.whom);
  input.particulars = await canonicalSpelling('particulars', input.particulars);

  const srnNo = await db.nextSrnNumber();
  const srn = formatSrn(srnNo);
  const now = new Date();
  const doc = {
    srnNo,
    srn,
    entryDate: input.entryDate,
    whom: input.whom,
    whomLower: input.whom.toLowerCase(),
    particulars: input.particulars,
    particularsLower: input.particulars.toLowerCase(),
    amountPaise: input.amountPaise,
    remark: input.remark,
    status: 'OPEN',
    closedDate: null,
    closedAt: null,
    closedBy: null,
    closedByUserId: null,
    closingRemark: null,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    version: 1,
    createdAt: now,
    createdBy: user ? user.displayName : 'System',
    createdByUserId: user ? user.id : null,
    updatedAt: null,
    updatedBy: null,
  };
  const { insertedId } = await db.collections.entries().insertOne(doc);
  await audit.logAction({ entryId: insertedId, action: 'CREATE', details: { srn, ...input }, user });
  return mapEntry({ ...doc, _id: insertedId }, todayISO());
}

async function updateEntry(id, body, user) {
  const doc = await requireActiveDoc(id);
  if (doc.status === 'CLOSED') throw new HttpError(409, `${doc.srn} is closed and can no longer be edited.`);
  checkVersion(doc, body.version);

  const input = validateEntryInput(body, todayISO());
  input.whom = await canonicalSpelling('whom', input.whom, doc._id);
  input.particulars = await canonicalSpelling('particulars', input.particulars, doc._id);

  const current = {
    entryDate: doc.entryDate,
    whom: doc.whom,
    particulars: doc.particulars,
    amountPaise: doc.amountPaise,
    remark: doc.remark ?? null,
  };
  const changes = {};
  for (const key of Object.keys(current)) {
    if ((current[key] ?? null) !== (input[key] ?? null)) changes[key] = { from: current[key], to: input[key] };
  }
  if (Object.keys(changes).length === 0) return mapEntry(doc, todayISO());

  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, version: doc.version, status: 'OPEN', isDeleted: false },
    {
      $set: {
        entryDate: input.entryDate,
        whom: input.whom,
        whomLower: input.whom.toLowerCase(),
        particulars: input.particulars,
        particularsLower: input.particulars.toLowerCase(),
        amountPaise: input.amountPaise,
        remark: input.remark,
        updatedAt: new Date(),
        updatedBy: user.displayName,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );
  const updated = updatedDoc(result);
  if (!updated) throw new HttpError(409, 'Entry was changed by someone else. Please reload and try again.');
  await audit.logAction({ entryId: doc._id, action: 'UPDATE', details: { srn: doc.srn, changes }, user });
  return mapEntry(updated, todayISO());
}

async function closeEntry(id, body, user) {
  const doc = await requireActiveDoc(id);
  if (doc.status === 'CLOSED') throw new HttpError(409, `${doc.srn} is already closed.`);
  checkVersion(doc, body.version);

  const closingRemark = cleanText(body.closingRemark);
  if (closingRemark.length > 500) {
    throw new HttpError(400, 'Closing remark is too long (max 500 characters).', { field: 'closingRemark' });
  }
  const today = todayISO();
  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, status: 'OPEN', isDeleted: false },
    {
      $set: {
        status: 'CLOSED',
        closedDate: today,
        closedAt: new Date(),
        closedBy: user.displayName,
        closedByUserId: user.id,
        closingRemark: closingRemark || null,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );
  const closed = updatedDoc(result);
  if (!closed) throw new HttpError(409, `${doc.srn} is already closed.`);
  const entry = mapEntry(closed, today);
  await audit.logAction({
    entryId: doc._id,
    action: 'CLOSE',
    details: { srn: doc.srn, closedDate: today, daysPending: entry.ageDays, closingRemark: closingRemark || null },
    user,
  });
  return entry;
}

async function reopenEntry(id, body, user) {
  const doc = await requireActiveDoc(id);
  if (doc.status !== 'CLOSED') throw new HttpError(409, `${doc.srn} is not closed.`);
  const reason = cleanText(body.reason);
  if (!reason) throw new HttpError(400, 'Enter the reason for reopening.', { field: 'reason' });
  if (reason.length > 500) throw new HttpError(400, 'Reason is too long (max 500 characters).', { field: 'reason' });

  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, status: 'CLOSED' },
    {
      $set: {
        status: 'OPEN',
        closedDate: null,
        closedAt: null,
        closedBy: null,
        closedByUserId: null,
        closingRemark: null,
        updatedAt: new Date(),
        updatedBy: user.displayName,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );
  const reopened = updatedDoc(result);
  if (!reopened) throw new HttpError(409, `${doc.srn} is not closed.`);
  await audit.logAction({
    entryId: doc._id,
    action: 'REOPEN',
    details: {
      srn: doc.srn,
      reason,
      previous: { closedDate: doc.closedDate, closedBy: doc.closedBy, closingRemark: doc.closingRemark },
    },
    user,
  });
  return mapEntry(reopened, todayISO());
}

async function deleteEntry(id, body, user) {
  const doc = await requireActiveDoc(id);
  const reason = cleanText(body.reason);
  if (!reason) throw new HttpError(400, 'Enter the reason for deleting this entry.', { field: 'reason' });
  if (reason.length > 500) throw new HttpError(400, 'Reason is too long (max 500 characters).', { field: 'reason' });

  const now = new Date();
  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, isDeleted: false },
    {
      $set: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: user.displayName,
        deleteReason: reason,
        updatedAt: now,
        updatedBy: user.displayName,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );
  const deleted = updatedDoc(result);
  if (!deleted) throw new HttpError(409, `${doc.srn} is already deleted.`);
  await audit.logAction({ entryId: doc._id, action: 'DELETE', details: { srn: doc.srn, reason }, user });
  return mapEntry(deleted, todayISO());
}

async function restoreEntry(id, user) {
  const doc = await findDoc(id);
  if (!doc) throw new HttpError(404, 'Entry not found.');
  if (!doc.isDeleted) throw new HttpError(409, `${doc.srn} is not deleted.`);

  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, isDeleted: true },
    {
      $set: {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
        updatedAt: new Date(),
        updatedBy: user.displayName,
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );
  const restored = updatedDoc(result);
  if (!restored) throw new HttpError(409, `${doc.srn} is not deleted.`);
  await audit.logAction({ entryId: doc._id, action: 'RESTORE', details: { srn: doc.srn }, user });
  return mapEntry(restored, todayISO());
}

module.exports = {
  getEntry,
  listEntries,
  dashboardSummary,
  lookups,
  nextSrn,
  createEntry,
  updateEntry,
  closeEntry,
  reopenEntry,
  deleteEntry,
  restoreEntry,
};
