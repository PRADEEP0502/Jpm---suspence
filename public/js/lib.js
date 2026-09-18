// Shared browser helpers: safe HTML templating, formatting, API calls, modals, toasts.

// ---------------------------------------------------------------------------
// HTML templating. Every interpolated value is escaped unless wrapped in raw()
// or produced by another html`` call, so user-entered text can never inject markup.
// ---------------------------------------------------------------------------

export class SafeHtml {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
export const raw = (s) => new SafeHtml(String(s));

function renderValue(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

export function setHtml(el, content) {
  el.innerHTML = renderValue(content);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// Formatting (Indian number grouping, DD/MM/YYYY dates)
// ---------------------------------------------------------------------------

export function fmtMoney(paise) {
  const rupees = (paise || 0) / 100;
  const hasFraction = (paise || 0) % 100 !== 0;
  return (
    '₹' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}

/** Amount as plain editable text, e.g. 125050 -> "1250.50" */
export function paiseToInput(paise) {
  const whole = Math.floor(paise / 100);
  const frac = paise % 100;
  return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${h}:${pad(d.getMinutes())} ${ampm}`;
}

export const fmtDays = (n) => `${n} ${n === 1 ? 'Day' : 'Days'}`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function parseAmountInput(value) {
  const s = String(value || '').replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.status = status;
    this.code = data.code;
    this.field = data.field;
  }
}

const apiListeners = { unauthorized: null };
export const onUnauthorized = (fn) => {
  apiListeners.unauthorized = fn;
};

export async function api(method, url, body) {
  const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (_) {
    throw new ApiError('Cannot reach the server. Please check the network connection and try again.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new ApiError((data && data.error) || `Request failed (${res.status}).`, res.status, data || {});
    if ((res.status === 401 && url !== '/api/auth/login') || err.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (apiListeners.unauthorized) apiListeners.unauthorized(err);
    }
    throw err;
  }
  return data;
}

export const toQuery = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function toast(message, type = 'success') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

// ---------------------------------------------------------------------------
// Modal dialogs
// ---------------------------------------------------------------------------

let modalSeq = 0;
const openModals = [];
export const isModalOpen = () => openModals.length > 0;
export const closeAllModals = () => [...openModals].reverse().forEach((m) => m.close());

/**
 * openModal({ title, size, dismissible }) -> { el, body, footer, close, onClose }
 * dismissible=false removes the close button and ignores Esc (used for forced password change).
 */
export function openModal({ title, size = 'md', dismissible = true }) {
  const id = `modal-title-${++modalSeq}`;
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  setHtml(
    backdrop,
    html`<div class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
      <div class="modal-header">
        <h2 class="modal-title" id="${id}">${title}</h2>
        ${dismissible ? html`<button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>` : ''}
      </div>
      <div class="modal-body"></div>
      <div class="modal-footer"></div>
    </div>`
  );
  document.getElementById('modalRoot').appendChild(backdrop);
  document.body.classList.add('has-modal');

  const handle = {
    el: backdrop.firstElementChild,
    body: backdrop.querySelector('.modal-body'),
    footer: backdrop.querySelector('.modal-footer'),
    onClose: null,
    close() {
      const i = openModals.indexOf(handle);
      if (i === -1) return;
      openModals.splice(i, 1);
      backdrop.remove();
      if (!openModals.length) document.body.classList.remove('has-modal');
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      if (handle.onClose) handle.onClose();
    },
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') && dismissible) handle.close();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      handle.close();
    }
    if (e.key === 'Tab') trapFocus(e, handle.el);
  });

  openModals.push(handle);
  requestAnimationFrame(() => {
    const first = handle.body.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    // Focus the first field; for read-only dialogs focus the dialog itself (no stray focus ring on a button).
    (first || handle.el).focus();
  });
  return handle;
}

function trapFocus(e, container) {
  const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', container).filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

export function clearFieldErrors(form) {
  $$('.field--error', form).forEach((f) => f.classList.remove('field--error'));
  $$('.field-error', form).forEach((e) => e.remove());
  const general = $('.form-error', form);
  if (general) {
    general.hidden = true;
    general.textContent = '';
  }
}

export function showFieldError(form, fieldName, message) {
  const input = fieldName ? form.querySelector(`[name="${fieldName}"]`) : null;
  const field = input ? input.closest('.field') : null;
  if (!field) {
    const general = $('.form-error', form);
    if (general) {
      general.textContent = message;
      general.hidden = false;
    } else {
      toast(message, 'error');
    }
    return;
  }
  field.classList.add('field--error');
  const msg = document.createElement('div');
  msg.className = 'field-error';
  msg.textContent = message;
  field.appendChild(msg);
  input.focus();
}

/** Disable a button while an async action runs, restoring its label afterwards. */
export async function withBusy(button, busyLabel, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}
