'use strict';

/**
 * Suspense entry lifecycle and all dashboard calculations.
 *
 * Every entry gets a permanent SRN (Suspense Reference Number: SRN-001, SRN-002, ...) when it is
 * created. It is the next running number, is never reused, and never changes on edit or close.
 *
 *   OPEN   --close-->  CLOSED        (entry user or admin; closed date = today, automatic)
 *   CLOSED --reopen--> OPEN          (admin only, reason required, audited)
 *   any    --delete--> deleted flag  (admin only, soft delete, reason required, restorable)
 *
 * Nothing is ever physically removed from the entries table.
 */

const db = require('./db');
const audit = require('./audit');
const {
  AGE_BUCKETS,
  DEFAULT_PARTICULARS,
  MAX_AMOUNT_PAISE,
  HttpError,
  todayISO,
  nowTimestamp,
  isValidISODate,
  bucketForAge,
  formatSrn,
  parseSrn,
  cleanText,
  parseAmountToPaise,
  escapeLike,
} = require('./util');

// Age in whole days = (closed date, or today while still open) - date the amount was given.
const AGE_SQL = 'MAX(0, CAST(julianday(COALESCE(e.closed_date, @today)) - julianday(e.entry_date) AS INTEGER))';
const BASE_SELECT = `SELECT e.*, ${AGE_SQL} AS age_days FROM entries e`;

const LIST_STATUSES = ['OPEN', 'CLOSED', 'ALL', 'DELETED'];

function mapEntry(r) {
  const bucket = bucketForAge(r.age_days);
  return {
    id: r.id,
    srnNo: r.srn_no,
    srn: r.srn,
    entryDate: r.entry_date,
    whom: r.whom,
    particulars: r.particulars,
    amountPaise: r.amount_paise,
    remark: r.remark,
    status: r.status,
    ageDays: r.age_days,
    ageBucket: bucket.key,
    ageLevel: bucket.level,
    ageLevelLabel: bucket.levelLabel,
    closedDate: r.closed_date,
    closedAt: r.closed_at,
    closedBy: r.closed_by,
    closingRemark: r.closing_remark,
    isDeleted: !!r.is_deleted,
    deletedAt: r.deleted_at,
    deletedBy: r.deleted_by,
    deleteReason: r.delete_reason,
    version: r.version,
    createdAt: r.created_at,
    createdBy: r.created_by,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function findRow(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.get(`${BASE_SELECT} WHERE e.id = @id`, { id: n, today: todayISO() }) || null;
}

function requireActiveRow(id) {
  const row = findRow(id);
  if (!row || row.is_deleted) throw new HttpError(404, 'Entry not found.');
  return row;
}

function checkVersion(row, version) {
  if (version === undefined || version === null || version === '') return;
  if (Number(version) !== row.version) {
    throw new HttpError(
      409,
      `${row.srn} was changed by someone else a moment ago. Please close this window and open the entry again.`,
      { code: 'VERSION_CONFLICT' }
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function getEntry(id, { includeDeleted = false } = {}) {
  const row = findRow(id);
  if (!row || (row.is_deleted && !includeDeleted)) return null;
  return mapEntry(row);
}

function listEntries(query = {}) {
  const today = todayISO();
  const params = { today };
  const where = [];

  const requested = String(query.status || 'ALL').toUpperCase();
  const status = LIST_STATUSES.includes(requested) ? requested : 'ALL';
  if (status === 'DELETED') {
    where.push('e.is_deleted = 1');
  } else {
    where.push('e.is_deleted = 0');
    if (status !== 'ALL') {
      where.push('e.status = @status');
      params.status = status;
    }
  }

  // One search box: SRN, whom or particulars. "SRN-001", "srn 1" or "SRN001" find exactly that record.
  const q = cleanText(query.q);
  const srnNo = parseSrn(q);
  if (srnNo !== null) {
    params.srnNo = srnNo;
    where.push('e.srn_no = @srnNo');
  } else if (q) {
    params.q = `%${escapeLike(q)}%`;
    where.push("(e.srn LIKE @q ESCAPE '\\' OR e.whom LIKE @q ESCAPE '\\' OR e.particulars LIKE @q ESCAPE '\\')");
  }

  const whom = cleanText(query.whom);
  if (whom) {
    params.whom = whom;
    where.push('e.whom = @whom COLLATE NOCASE');
  }

  const dateColumn = query.dateField === 'closed' ? 'e.closed_date' : 'e.entry_date';
  if (isValidISODate(query.dateFrom)) {
    params.dateFrom = query.dateFrom;
    where.push(`${dateColumn} >= @dateFrom`);
  }
  if (isValidISODate(query.dateTo)) {
    params.dateTo = query.dateTo;
    where.push(`${dateColumn} <= @dateTo`);
  }

  const bucket = AGE_BUCKETS.find((b) => b.key === query.age);
  if (bucket) {
    params.ageMin = bucket.min;
    where.push(`${AGE_SQL} >= @ageMin`);
    if (bucket.max !== null) {
      params.ageMax = bucket.max;
      where.push(`${AGE_SQL} <= @ageMax`);
    }
  }

  const amountMin = parseAmountToPaise(query.amountMin);
  if (query.amountMin && amountMin !== null) {
    params.amountMin = amountMin;
    where.push('e.amount_paise >= @amountMin');
  }
  const amountMax = parseAmountToPaise(query.amountMax);
  if (query.amountMax && amountMax !== null) {
    params.amountMax = amountMax;
    where.push('e.amount_paise <= @amountMax');
  }

  const rows = db.all(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.srn_no DESC`, params);
  const entries = rows.map(mapEntry);
  const amountPaise = entries.reduce((sum, e) => sum + e.amountPaise, 0);
  return { today, status, entries, totals: { count: entries.length, amountPaise } };
}

/** Everything the dashboard needs, computed from live (non-deleted) rows. */
function dashboardSummary() {
  const today = todayISO();
  const entries = db.all(`${BASE_SELECT} WHERE e.is_deleted = 0`, { today }).map(mapEntry);

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

/** Names and particulars already in use, for type-ahead suggestions and the Whom filter. */
function lookups() {
  const uniq = (values) => {
    const seen = new Map();
    values.forEach((v) => {
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  };
  const persons = db.all('SELECT DISTINCT whom AS v FROM entries WHERE is_deleted = 0').map((r) => r.v);
  const used = db.all('SELECT DISTINCT particulars AS v FROM entries WHERE is_deleted = 0').map((r) => r.v);
  return {
    persons: uniq(persons),
    suggestedParticulars: uniq([...DEFAULT_PARTICULARS, ...used]),
  };
}

/** SRN the next new entry will receive (shown read-only in the Add form). */
function nextSrn() {
  const { n } = db.get('SELECT COALESCE(MAX(srn_no), 0) + 1 AS n FROM entries');
  return formatSrn(n);
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
  if (!whom) throw new HttpError(400, 'Enter whom the amount was given to.', { field: 'whom' });
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
function canonicalSpelling(column, value, excludeId = 0) {
  if (!['whom', 'particulars'].includes(column)) throw new Error('Invalid column');
  const row = db.get(
    `SELECT ${column} AS v FROM entries
      WHERE ${column} = @value COLLATE NOCASE AND id != @excludeId AND is_deleted = 0
      ORDER BY id LIMIT 1`,
    { value, excludeId }
  );
  if (row) return row.v;
  if (column === 'particulars') {
    const standard = DEFAULT_PARTICULARS.find((p) => p.toLowerCase() === value.toLowerCase());
    if (standard) return standard;
  }
  return value;
}

function createEntry(body, user) {
  const input = validateEntryInput(body, todayISO());
  input.whom = canonicalSpelling('whom', input.whom);
  input.particulars = canonicalSpelling('particulars', input.particulars);

  return db.transaction(() => {
    const { n: srnNo } = db.get('SELECT COALESCE(MAX(srn_no), 0) + 1 AS n FROM entries');
    const srn = formatSrn(srnNo);
    const { lastId } = db.run(
      `INSERT INTO entries (srn_no, srn, entry_date, whom, particulars, amount_paise, remark,
                            status, created_at, created_by, created_by_user_id)
       VALUES (@srnNo, @srn, @entryDate, @whom, @particulars, @amountPaise, @remark,
               'OPEN', @now, @by, @byId)`,
      {
        ...input,
        srnNo,
        srn,
        now: nowTimestamp(),
        by: user ? user.displayName : 'System',
        byId: user ? user.id : null,
      }
    );
    audit.logAction({ entryId: lastId, action: 'CREATE', details: { srn, ...input }, user });
    return getEntry(lastId);
  });
}

function updateEntry(id, body, user) {
  const row = requireActiveRow(id);
  if (row.status === 'CLOSED') {
    throw new HttpError(409, `${row.srn} is closed and can no longer be edited.`);
  }
  checkVersion(row, body.version);

  const input = validateEntryInput(body, todayISO());
  input.whom = canonicalSpelling('whom', input.whom, row.id);
  input.particulars = canonicalSpelling('particulars', input.particulars, row.id);

  const current = {
    entryDate: row.entry_date,
    whom: row.whom,
    particulars: row.particulars,
    amountPaise: row.amount_paise,
    remark: row.remark,
  };
  const changes = {};
  for (const key of Object.keys(current)) {
    if ((current[key] ?? null) !== (input[key] ?? null)) changes[key] = { from: current[key], to: input[key] };
  }
  if (Object.keys(changes).length === 0) return mapEntry(row);

  return db.transaction(() => {
    const { changes: updated } = db.run(
      `UPDATE entries
          SET entry_date = @entryDate, whom = @whom, particulars = @particulars,
              amount_paise = @amountPaise, remark = @remark,
              version = version + 1, updated_at = @now, updated_by = @by
        WHERE id = @id AND version = @version AND status = 'OPEN' AND is_deleted = 0`,
      { ...input, id: row.id, version: row.version, now: nowTimestamp(), by: user.displayName }
    );
    if (updated !== 1) throw new HttpError(409, 'Entry was changed by someone else. Please reload and try again.');
    audit.logAction({ entryId: row.id, action: 'UPDATE', details: { srn: row.srn, changes }, user });
    return getEntry(row.id);
  });
}

function closeEntry(id, body, user) {
  const row = requireActiveRow(id);
  if (row.status === 'CLOSED') throw new HttpError(409, `${row.srn} is already closed.`);
  checkVersion(row, body.version);

  const closingRemark = cleanText(body.closingRemark);
  if (closingRemark.length > 500) {
    throw new HttpError(400, 'Closing remark is too long (max 500 characters).', { field: 'closingRemark' });
  }
  const today = todayISO();
  const now = nowTimestamp();

  return db.transaction(() => {
    const { changes } = db.run(
      `UPDATE entries
          SET status = 'CLOSED', closed_date = @today, closed_at = @now, closed_by = @by,
              closed_by_user_id = @byId, closing_remark = @closingRemark,
              version = version + 1
        WHERE id = @id AND status = 'OPEN' AND is_deleted = 0`,
      { id: row.id, today, now, by: user.displayName, byId: user.id, closingRemark: closingRemark || null }
    );
    if (changes !== 1) throw new HttpError(409, `${row.srn} is already closed.`);
    const entry = getEntry(row.id);
    audit.logAction({
      entryId: row.id,
      action: 'CLOSE',
      details: {
        srn: row.srn,
        closedDate: today,
        daysPending: entry.ageDays,
        closingRemark: closingRemark || null,
      },
      user,
    });
    return entry;
  });
}

function reopenEntry(id, body, user) {
  const row = requireActiveRow(id);
  if (row.status !== 'CLOSED') throw new HttpError(409, `${row.srn} is not closed.`);
  const reason = cleanText(body.reason);
  if (!reason) throw new HttpError(400, 'Enter the reason for reopening.', { field: 'reason' });
  if (reason.length > 500) throw new HttpError(400, 'Reason is too long (max 500 characters).', { field: 'reason' });

  return db.transaction(() => {
    db.run(
      `UPDATE entries
          SET status = 'OPEN', closed_date = NULL, closed_at = NULL, closed_by = NULL,
              closed_by_user_id = NULL, closing_remark = NULL,
              version = version + 1, updated_at = @now, updated_by = @by
        WHERE id = @id`,
      { id: row.id, now: nowTimestamp(), by: user.displayName }
    );
    audit.logAction({
      entryId: row.id,
      action: 'REOPEN',
      details: {
        srn: row.srn,
        reason,
        previous: { closedDate: row.closed_date, closedBy: row.closed_by, closingRemark: row.closing_remark },
      },
      user,
    });
    return getEntry(row.id);
  });
}

function deleteEntry(id, body, user) {
  const row = requireActiveRow(id);
  const reason = cleanText(body.reason);
  if (!reason) throw new HttpError(400, 'Enter the reason for deleting this entry.', { field: 'reason' });
  if (reason.length > 500) throw new HttpError(400, 'Reason is too long (max 500 characters).', { field: 'reason' });

  return db.transaction(() => {
    const now = nowTimestamp();
    db.run(
      `UPDATE entries
          SET is_deleted = 1, deleted_at = @now, deleted_by = @by, delete_reason = @reason,
              version = version + 1, updated_at = @now, updated_by = @by
        WHERE id = @id`,
      { id: row.id, now, by: user.displayName, reason }
    );
    audit.logAction({ entryId: row.id, action: 'DELETE', details: { srn: row.srn, reason }, user });
    return getEntry(row.id, { includeDeleted: true });
  });
}

function restoreEntry(id, user) {
  const row = findRow(id);
  if (!row) throw new HttpError(404, 'Entry not found.');
  if (!row.is_deleted) throw new HttpError(409, `${row.srn} is not deleted.`);

  return db.transaction(() => {
    db.run(
      `UPDATE entries
          SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_reason = NULL,
              version = version + 1, updated_at = @now, updated_by = @by
        WHERE id = @id`,
      { id: row.id, now: nowTimestamp(), by: user.displayName }
    );
    audit.logAction({ entryId: row.id, action: 'RESTORE', details: { srn: row.srn }, user });
    return getEntry(row.id);
  });
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
