'use strict';

/**
 * Suspense entries, returns, ownership and all dashboard calculations (MongoDB).
 *
 * SRN (Suspense Reference Number): SRN-001, SRN-002, ... from an atomic counter; never reused and
 * never changed - not by an edit, a return or the closing of the entry.
 *
 * Money (the Original Amount is never overwritten):
 *   Original Amount   what was handed over
 *   Returns[]         every return: date, returned by, amount, remark, who recorded it
 *   Returned Amount   total of the returns
 *   Balance Amount    Original - Returned
 *
 *   OPEN       nothing returned yet
 *   PARTIAL    something returned, balance still outstanding    ("Partially Settled")
 *   CLOSED     balance is zero. This happens by itself when the last return is recorded;
 *              there is no manual close while any balance remains.
 *
 * Who can see what is decided here, in the database query - not in the browser:
 *   users with "entries:viewAll" (Entry User, Admin, MD) see every entry;
 *   everyone else sees only entries linked to their own login (givenToUserId).
 */

const db = require('./db');
const audit = require('./audit');
const users = require('./users');
const permissions = require('./permissions');
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
  formatRupees,
} = require('./util');

// PENDING = anything still owed (OPEN or PARTIAL).
const LIST_STATUSES = ['PENDING', 'OPEN', 'PARTIAL', 'CLOSED', 'ALL', 'DELETED'];

// ---------------------------------------------------------------------------
// Who may see what
// ---------------------------------------------------------------------------

/** Database filter that limits a query to the records this user is allowed to see. */
function scopeFilter(user) {
  if (permissions.can(user, 'entries:viewAll')) return {};
  if (permissions.can(user, 'own:view')) {
    const id = db.toObjectId(user.id);
    if (id) return { givenToUserId: id };
  }
  throw new HttpError(403, 'You do not have permission to view suspense records.', { code: 'FORBIDDEN' });
}

const canSeeDeleted = (user) => permissions.can(user, 'entries:delete');

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function ageOf(doc, today) {
  if (doc.status === 'CLOSED' && typeof doc.finalAgeDays === 'number') return doc.finalAgeDays;
  return Math.max(0, daysBetween(doc.entryDate, doc.closedDate || today));
}

/** Status follows the money: nothing back = OPEN, part back = PARTIAL, all back = CLOSED. */
function statusFor(returnedPaise, originalPaise) {
  if (returnedPaise <= 0) return 'OPEN';
  return returnedPaise >= originalPaise ? 'CLOSED' : 'PARTIAL';
}

function mapReturn(r) {
  return {
    id: String(r.id),
    returnDate: r.returnDate,
    returnedBy: r.returnedBy,
    amountPaise: r.amountPaise,
    remark: r.remark ?? null,
    recordedBy: r.recordedBy ?? null,
    recordedAt: r.recordedAt ?? null,
  };
}

function mapEntry(doc, today) {
  const ageDays = ageOf(doc, today);
  const bucket = bucketForAge(ageDays);
  const returnedPaise = doc.returnedPaise || 0;
  return {
    id: String(doc._id),
    srnNo: doc.srnNo,
    srn: doc.srn,
    entryDate: doc.entryDate,
    whom: doc.whom,
    particulars: doc.particulars,
    amountPaise: doc.amountPaise, // Original Amount
    returnedPaise,
    balancePaise: doc.amountPaise - returnedPaise,
    returns: (doc.returns || []).map(mapReturn),
    returnCount: (doc.returns || []).length,
    remark: doc.remark ?? null,
    status: doc.status,
    ageDays,
    ageBucket: bucket.key,
    ageLevel: bucket.level,
    ageLevelLabel: bucket.levelLabel,
    closedDate: doc.closedDate ?? null,
    closedAt: doc.closedAt ?? null,
    closedBy: doc.closedBy ?? null,
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
// Reads (always scoped to what the caller may see)
// ---------------------------------------------------------------------------

/** One entry, or null when it does not exist OR belongs to someone else (never reveals which). */
async function getEntry(id, user) {
  const _id = db.toObjectId(id);
  if (!_id) return null;
  const filter = { _id, ...scopeFilter(user) };
  if (!canSeeDeleted(user)) filter.isDeleted = false;
  const doc = await db.collections.entries().findOne(filter);
  return doc ? mapEntry(doc, todayISO()) : null;
}

async function listEntries(query, user) {
  const today = todayISO();
  const filter = { ...scopeFilter(user) };

  const requested = String(query.status || 'ALL').toUpperCase();
  const status = LIST_STATUSES.includes(requested) ? requested : 'ALL';
  if (status === 'DELETED') {
    if (!canSeeDeleted(user)) throw new HttpError(403, 'You do not have permission to do this.', { code: 'FORBIDDEN' });
    filter.isDeleted = true;
  } else {
    filter.isDeleted = false;
    if (status === 'PENDING') filter.status = { $in: ['OPEN', 'PARTIAL'] };
    else if (status !== 'ALL') filter.status = status;
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

  const bucket = AGE_BUCKETS.find((b) => b.key === query.age);
  if (bucket) {
    entries = entries.filter((e) => e.ageDays >= bucket.min && (bucket.max === null || e.ageDays <= bucket.max));
  }

  const totals = entries.reduce(
    (t, e) => ({
      count: t.count + 1,
      amountPaise: t.amountPaise + e.amountPaise,
      returnedPaise: t.returnedPaise + e.returnedPaise,
      balancePaise: t.balancePaise + e.balancePaise,
    }),
    { count: 0, amountPaise: 0, returnedPaise: 0, balancePaise: 0 }
  );
  return { today, status, entries, totals };
}

/** Dashboard figures, calculated from the entries this user is allowed to see. */
async function dashboardSummary(user) {
  const today = todayISO();
  const docs = await db.collections.entries().find({ isDeleted: false, ...scopeFilter(user) }).toArray();
  const entries = docs.map((doc) => mapEntry(doc, today));

  const cards = {
    totalCount: 0,
    totalOriginalPaise: 0, // TOTAL SUSPENSE AMOUNT: everything ever given
    totalReturnedPaise: 0,
    totalBalancePaise: 0,
    openCount: 0, // OPEN ENTRIES
    openAmountPaise: 0, // OPEN AMOUNT: balance of entries with nothing returned yet
    partialCount: 0, // PARTIALLY SETTLED ENTRIES
    partialAmountPaise: 0, // PARTIALLY SETTLED AMOUNT: balance still pending on them
    partialOriginalPaise: 0,
    closedCount: 0,
    closedAmountPaise: 0, // CLOSED AMOUNT: what was given in entries now fully returned
    pendingCount: 0,
    oldestPendingDays: null,
  };

  const blank = (name) => ({
    name,
    totalCount: 0,
    originalAmountPaise: 0,
    returnedAmountPaise: 0,
    balanceAmountPaise: 0,
    pendingCount: 0,
    closedCount: 0,
    oldestPendingDays: null,
  });
  const persons = new Map();
  const particulars = new Map();
  const aging = AGE_BUCKETS.map((b) => ({ ...b, count: 0, amountPaise: 0 }));
  const group = (map, name) => {
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, blank(name));
    return map.get(key);
  };

  for (const e of entries) {
    const pending = e.status !== 'CLOSED';

    cards.totalCount += 1;
    cards.totalOriginalPaise += e.amountPaise;
    cards.totalReturnedPaise += e.returnedPaise;
    cards.totalBalancePaise += e.balancePaise;
    if (e.status === 'OPEN') {
      cards.openCount += 1;
      cards.openAmountPaise += e.balancePaise;
    } else if (e.status === 'PARTIAL') {
      cards.partialCount += 1;
      cards.partialAmountPaise += e.balancePaise;
      cards.partialOriginalPaise += e.amountPaise;
    } else {
      cards.closedCount += 1;
      cards.closedAmountPaise += e.amountPaise;
    }
    if (pending) {
      cards.pendingCount += 1;
      cards.oldestPendingDays = Math.max(cards.oldestPendingDays ?? 0, e.ageDays);
      const b = aging.find((a) => a.key === e.ageBucket);
      b.count += 1;
      b.amountPaise += e.balancePaise; // aging is about money still outstanding
    }

    for (const g of [group(persons, e.whom), group(particulars, e.particulars)]) {
      g.totalCount += 1;
      g.originalAmountPaise += e.amountPaise;
      g.returnedAmountPaise += e.returnedPaise;
      g.balanceAmountPaise += e.balancePaise;
      if (pending) {
        g.pendingCount += 1;
        g.oldestPendingDays = Math.max(g.oldestPendingDays ?? 0, e.ageDays);
      } else {
        g.closedCount += 1;
      }
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  return {
    today,
    cards,
    aging,
    persons: [...persons.values()].sort(
      (a, b) => b.balanceAmountPaise - a.balanceAmountPaise || b.originalAmountPaise - a.originalAmountPaise || byName(a, b)
    ),
    particulars: [...particulars.values()].sort(
      (a, b) => b.originalAmountPaise - a.originalAmountPaise || b.balanceAmountPaise - a.balanceAmountPaise || byName(a, b)
    ),
  };
}

/** Names for the Given To and filter lists. Only for people who may see every record. */
async function lookups(user) {
  if (!permissions.can(user, 'entries:viewAll')) {
    throw new HttpError(403, 'You do not have permission to do this.', { code: 'FORBIDDEN' });
  }
  const uniq = (values) => {
    const seen = new Map();
    values.forEach((v) => {
      const key = String(v).toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  };
  const entries = db.collections.entries();
  const [persons, used, employees] = await Promise.all([
    entries.distinct('whom', { isDeleted: false }),
    entries.distinct('particulars', { isDeleted: false }),
    users.employeeNames(),
  ]);
  return {
    persons: uniq([...persons, ...employees.map((e) => e.name)]),
    employees, // people with a login: records given to them are visible to them
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

/**
 * Settle the spelling of "Given To": a person with a login always uses that login's name (which is
 * what links the record to them); otherwise reuse the spelling already used elsewhere.
 * Returns the final name and the login it belongs to (or null).
 */
async function resolveGivenTo(name, excludeId = null) {
  const person = await users.findByName(name);
  if (person) return { whom: person.displayName, givenToUserId: person._id };
  const filter = { whomLower: name.toLowerCase(), isDeleted: false };
  if (excludeId) filter._id = { $ne: excludeId };
  const doc = await db.collections.entries().find(filter).sort({ _id: 1 }).limit(1).next();
  return { whom: doc ? doc.whom : name, givenToUserId: null };
}

async function canonicalParticulars(value, excludeId = null) {
  const filter = { particularsLower: value.toLowerCase(), isDeleted: false };
  if (excludeId) filter._id = { $ne: excludeId };
  const doc = await db.collections.entries().find(filter).sort({ _id: 1 }).limit(1).next();
  if (doc) return doc.particulars;
  return DEFAULT_PARTICULARS.find((p) => p.toLowerCase() === value.toLowerCase()) || value;
}

async function createEntry(body, user) {
  const input = validateEntryInput(body, todayISO());
  const given = await resolveGivenTo(input.whom);
  input.whom = given.whom;
  input.particulars = await canonicalParticulars(input.particulars);

  const srnNo = await db.nextSrnNumber();
  const srn = formatSrn(srnNo);
  const now = new Date();
  const doc = {
    srnNo,
    srn,
    entryDate: input.entryDate,
    whom: input.whom,
    whomLower: input.whom.toLowerCase(),
    givenToUserId: given.givenToUserId,
    particulars: input.particulars,
    particularsLower: input.particulars.toLowerCase(),
    amountPaise: input.amountPaise,
    returnedPaise: 0,
    returns: [],
    remark: input.remark,
    status: 'OPEN',
    closedDate: null,
    closedAt: null,
    closedBy: null,
    closedByUserId: null,
    finalAgeDays: null,
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
  const given = await resolveGivenTo(input.whom, doc._id);
  input.whom = given.whom;
  input.particulars = await canonicalParticulars(input.particulars, doc._id);

  // The Original Amount may be corrected, but never below what has already been returned.
  const returnedPaise = doc.returnedPaise || 0;
  if (input.amountPaise < returnedPaise) {
    throw new HttpError(
      400,
      `Original amount cannot be less than the amount already returned (${formatRupees(returnedPaise)}).`,
      { field: 'amount' }
    );
  }
  if (input.entryDate > (doc.returns || []).reduce((min, r) => (r.returnDate < min ? r.returnDate : min), '9999-12-31')) {
    throw new HttpError(400, 'The date given cannot be later than a return that is already recorded.', {
      field: 'entryDate',
    });
  }

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

  // Lowering the amount to exactly what was returned leaves nothing outstanding, so it closes.
  const status = statusFor(returnedPaise, input.amountPaise);
  const today = todayISO();
  const closing =
    status === 'CLOSED' && doc.status !== 'CLOSED'
      ? {
          closedDate: today,
          closedAt: new Date(),
          closedBy: user.displayName,
          closedByUserId: user.id,
          finalAgeDays: Math.max(0, daysBetween(input.entryDate, today)),
        }
      : {};

  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, version: doc.version, isDeleted: false },
    {
      $set: {
        entryDate: input.entryDate,
        whom: input.whom,
        whomLower: input.whom.toLowerCase(),
        givenToUserId: given.givenToUserId,
        particulars: input.particulars,
        particularsLower: input.particulars.toLowerCase(),
        amountPaise: input.amountPaise,
        remark: input.remark,
        status,
        ...closing,
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

// ---------------------------------------------------------------------------
// Returns (money coming back to JPM)
// ---------------------------------------------------------------------------

function validateReturnInput(body, doc, today) {
  const returnDate = String(body.returnDate || '').trim();
  if (!isValidISODate(returnDate)) throw new HttpError(400, 'Enter a valid return date.', { field: 'returnDate' });
  if (returnDate > today) throw new HttpError(400, 'Return date cannot be in the future.', { field: 'returnDate' });
  if (returnDate < doc.entryDate) {
    throw new HttpError(400, 'Return date cannot be before the date the amount was given.', { field: 'returnDate' });
  }

  const returnedBy = cleanText(body.returnedBy) || doc.whom;
  if (returnedBy.length > 100) throw new HttpError(400, 'Name is too long (max 100 characters).', { field: 'returnedBy' });

  const balancePaise = doc.amountPaise - (doc.returnedPaise || 0);
  const amountPaise = parseAmountToPaise(body.amount);
  if (amountPaise === null || amountPaise <= 0) {
    throw new HttpError(400, 'Enter a valid returned amount greater than zero (for example 500 or 250.50).', {
      field: 'amount',
    });
  }
  if (amountPaise > balancePaise) {
    throw new HttpError(
      400,
      `Returned amount cannot be greater than the remaining balance of ${formatRupees(balancePaise)}.`,
      { field: 'amount' }
    );
  }

  const remark = cleanText(body.remark);
  if (remark.length > 500) throw new HttpError(400, 'Return remark is too long (max 500 characters).', { field: 'remark' });

  return { returnDate, returnedBy, amountPaise, remark: remark || null };
}

/**
 * Record money returned by the person. When the balance reaches zero the entry closes by itself:
 * the closed date is the date of that final return, and the final age is fixed at that moment.
 */
async function addReturn(id, body, user) {
  const doc = await requireActiveDoc(id);
  if (doc.status === 'CLOSED') {
    throw new HttpError(409, `${doc.srn} is already closed - nothing is left to return.`);
  }
  checkVersion(doc, body.version);

  const today = todayISO();
  const input = validateReturnInput(body, doc, today);

  const entry = {
    id: new db.ObjectId(),
    returnDate: input.returnDate,
    returnedBy: input.returnedBy,
    amountPaise: input.amountPaise,
    remark: input.remark,
    recordedBy: user.displayName,
    recordedByUserId: user.id,
    recordedAt: new Date(),
  };
  const returns = [...(doc.returns || []), entry];
  const returnedPaise = (doc.returnedPaise || 0) + input.amountPaise;
  const balancePaise = doc.amountPaise - returnedPaise;
  const status = statusFor(returnedPaise, doc.amountPaise);

  const set = { returns, returnedPaise, status, updatedAt: new Date(), updatedBy: user.displayName };
  let finalAgeDays = null;
  if (status === 'CLOSED') {
    finalAgeDays = Math.max(0, daysBetween(doc.entryDate, input.returnDate));
    set.closedDate = input.returnDate;
    set.closedAt = new Date();
    set.closedBy = user.displayName;
    set.closedByUserId = user.id;
    set.finalAgeDays = finalAgeDays;
  }

  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, version: doc.version, isDeleted: false, status: { $ne: 'CLOSED' } },
    { $set: set, $inc: { version: 1 } },
    { returnDocument: 'after' }
  );
  const updated = updatedDoc(result);
  if (!updated) {
    throw new HttpError(409, `${doc.srn} was changed by someone else a moment ago. Please reopen the entry and try again.`, {
      code: 'VERSION_CONFLICT',
    });
  }

  await audit.logAction({
    entryId: doc._id,
    action: 'RETURN',
    details: {
      srn: doc.srn,
      returnDate: input.returnDate,
      returnedBy: input.returnedBy,
      amountPaise: input.amountPaise,
      remark: input.remark,
      returnedTotalPaise: returnedPaise,
      balancePaise,
      status,
      ...(status === 'CLOSED' ? { closedDate: input.returnDate, finalAgeDays } : {}),
    },
    user,
  });
  return mapEntry(updated, today);
}

/** There is no manual close: an entry closes itself when its balance reaches zero. */
async function closeEntry(id) {
  const doc = await requireActiveDoc(id);
  if (doc.status === 'CLOSED') throw new HttpError(409, `${doc.srn} is already closed.`);
  const balancePaise = doc.amountPaise - (doc.returnedPaise || 0);
  throw new HttpError(
    409,
    `${doc.srn} still has a balance of ${formatRupees(balancePaise)}. It closes automatically once the full amount has been returned - use Add Return.`,
    { code: 'BALANCE_OUTSTANDING' }
  );
}

async function reopenEntry(id, body, user) {
  const doc = await requireActiveDoc(id);
  if (doc.status !== 'CLOSED') throw new HttpError(409, `${doc.srn} is not closed.`);
  const reason = cleanText(body.reason);
  if (!reason) throw new HttpError(400, 'Enter the reason for reopening.', { field: 'reason' });
  if (reason.length > 500) throw new HttpError(400, 'Reason is too long (max 500 characters).', { field: 'reason' });

  // Reopening undoes the last return (the one that closed it) and puts that amount back in the balance.
  const returns = [...(doc.returns || [])];
  const removed = returns.pop() || null;
  const returnedPaise = returns.reduce((sum, r) => sum + r.amountPaise, 0);
  const status = statusFor(returnedPaise, doc.amountPaise);

  const result = await db.collections.entries().findOneAndUpdate(
    { _id: doc._id, status: 'CLOSED' },
    {
      $set: {
        returns,
        returnedPaise,
        status,
        closedDate: null,
        closedAt: null,
        closedBy: null,
        closedByUserId: null,
        finalAgeDays: null,
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
      status,
      removedReturn: removed
        ? { returnDate: removed.returnDate, returnedBy: removed.returnedBy, amountPaise: removed.amountPaise, remark: removed.remark }
        : null,
      previous: { closedDate: doc.closedDate, closedBy: doc.closedBy },
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
  addReturn,
  closeEntry,
  reopenEntry,
  deleteEntry,
  restoreEntry,
};
