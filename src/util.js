'use strict';

/**
 * Shared helpers: business dates, money parsing, validation, age buckets.
 * All "today" logic runs in the office time zone so age is the same for
 * every viewer regardless of where the server or browser clock is set.
 */

const config = require('./config');

const TIMEZONE = config.TIMEZONE;

// Upper bound per entry: Rs 10 crore. Guards against typos like an extra zero run.
const MAX_AMOUNT_PAISE = 10_000_000_000;

const AGE_BUCKETS = [
  { key: '0-7', label: '0–7 Days', min: 0, max: 7, level: 'normal', levelLabel: 'Normal' },
  { key: '8-15', label: '8–15 Days', min: 8, max: 15, level: 'attention', levelLabel: 'Attention' },
  { key: '16-30', label: '16–30 Days', min: 16, max: 30, level: 'warning', levelLabel: 'Warning' },
  { key: '31-60', label: '31–60 Days', min: 31, max: 60, level: 'critical', levelLabel: 'Critical' },
  { key: '60+', label: '60+ Days', min: 61, max: null, level: 'very-critical', levelLabel: 'Very Critical' },
];

const DEFAULT_PARTICULARS = [
  'Stationery',
  'Labour Charges',
  'Travel',
  'Purchase',
  'Wages',
  'Auto Charges',
  'Other',
];

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function todayISO() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nowTimestamp() {
  return new Date().toISOString();
}

function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days between two YYYY-MM-DD dates (time zones cannot shift the result). */
function daysBetween(fromISO, toISO) {
  const at = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(toISO) - at(fromISO)) / 86400000);
}

function bucketForAge(days) {
  return AGE_BUCKETS.find((b) => days >= b.min && (b.max === null || days <= b.max)) || AGE_BUCKETS[0];
}

/** SRN = Suspense Reference Number, e.g. 1 -> SRN-001. */
function formatSrn(srnNo) {
  return `SRN-${String(srnNo).padStart(3, '0')}`;
}

/** If a search term is an SRN ("SRN-001", "srn 1", "SRN001"), return its number; otherwise null. */
function parseSrn(value) {
  const m = /^srn[\s-]*0*(\d{1,9})$/i.exec(String(value || '').trim());
  return m ? Number(m[1]) : null;
}

/** Collapse runs of whitespace and trim. Returns '' for null/undefined. */
function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/** Parse a rupee amount ("1,250.50", 1250.5) into integer paise. Returns null if invalid. */
function parseAmountToPaise(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Rupees for messages: 200 -> ₹200, 1250.5 -> ₹1,250.50 (Indian grouping). */
function formatRupees(paise) {
  const rupees = (paise || 0) / 100;
  const hasFraction = (paise || 0) % 100 !== 0;
  return (
    '₹' +
    rupees.toLocaleString('en-IN', { minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2 })
  );
}

/** Make user input safe to use inside a regular expression (search box). */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  TIMEZONE,
  MAX_AMOUNT_PAISE,
  AGE_BUCKETS,
  DEFAULT_PARTICULARS,
  HttpError,
  todayISO,
  nowTimestamp,
  isValidISODate,
  daysBetween,
  bucketForAge,
  formatSrn,
  parseSrn,
  cleanText,
  parseAmountToPaise,
  escapeRegex,
  formatRupees,
};
