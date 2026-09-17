// Dialogs for viewing and changing entries, plus password change.

import {
  html,
  setHtml,
  $,
  api,
  toast,
  openModal,
  fmtMoney,
  fmtDate,
  fmtDateTime,
  fmtDays,
  paiseToInput,
  parseAmountInput,
  clearFieldErrors,
  showFieldError,
  withBusy,
} from './lib.js';
import { state, canManage, isAdmin, refreshView } from './state.js';
import { statusBadge, ageBadge } from './ui.js';

// ---------------------------------------------------------------------------
// Entry detail (view-only for visitors; actions for logged-in staff)
// ---------------------------------------------------------------------------

const FIELD_LABELS = {
  entryDate: 'Date',
  whom: 'Whom',
  particulars: 'Particulars',
  amountPaise: 'Amount',
  remark: 'Remark',
};

function fieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '(blank)';
  if (key === 'amountPaise') return fmtMoney(value);
  if (key === 'entryDate') return fmtDate(value);
  return value;
}

function describeHistory(h) {
  const d = h.details || {};
  switch (h.action) {
    case 'CREATE':
      return {
        title: 'Entry created',
        text: `${fmtMoney(d.amountPaise)} given to ${d.whom} for ${d.particulars}, dated ${fmtDate(d.entryDate)}.`,
      };
    case 'UPDATE':
      return {
        title: 'Entry edited',
        text: Object.entries(d.changes || {})
          .map(([k, c]) => `${FIELD_LABELS[k] || k}: ${fieldValue(k, c.from)} → ${fieldValue(k, c.to)}`)
          .join('; '),
      };
    case 'CLOSE':
      return {
        title: 'Entry closed',
        text: `Closed on ${fmtDate(d.closedDate)} after ${fmtDays(d.daysPending)}.${
          d.closingRemark ? ` Remark: ${d.closingRemark}` : ''
        }`,
      };
    case 'REOPEN':
      return { title: 'Entry reopened', text: `Reason: ${d.reason}` };
    case 'DELETE':
      return { title: 'Entry deleted', text: `Reason: ${d.reason}` };
    case 'RESTORE':
      return { title: 'Entry restored', text: '' };
    default:
      return { title: h.action, text: '' };
  }
}

function detailItem(label, value, wide = false) {
  return html`<div class="detail-item ${wide ? 'detail-item--wide' : ''}">
    <dt>${label}</dt>
    <dd>${value === null || value === undefined || value === '' ? html`<span class="muted">—</span>` : value}</dd>
  </div>`;
}

export async function showEntryDetail(entryOrId) {
  const id = typeof entryOrId === 'object' ? entryOrId.id : entryOrId;
  let data;
  try {
    data = await api('GET', `/api/entries/${id}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const { entry: e, history } = data;
  const m = openModal({ title: `Suspense Entry ${e.srn}`, size: 'lg' });

  setHtml(
    m.body,
    html`
      <div class="detail-head">
        <div>
          <div class="detail-whom">${e.whom}</div>
          <div class="detail-what">${e.particulars}</div>
        </div>
        <div class="detail-amount-wrap">
          <div class="detail-amount">${fmtMoney(e.amountPaise)}</div>
          ${statusBadge(e)}
        </div>
      </div>

      <dl class="detail-grid">
        ${detailItem('SRN', e.srn)}
        ${detailItem('Date Given', fmtDate(e.entryDate))}
        ${detailItem(e.status === 'OPEN' ? 'Age' : 'Age / Days Pending', ageBadge(e, { withLevel: e.status === 'OPEN' }))}
        ${detailItem('Remark', e.remark, true)}
        ${e.status === 'CLOSED'
          ? html`${detailItem('Closed Date', fmtDate(e.closedDate))} ${detailItem('Closed By', e.closedBy)}
            ${detailItem('Closing Remark', e.closingRemark)}`
          : ''}
        ${e.isDeleted
          ? html`${detailItem('Deleted On', fmtDateTime(e.deletedAt))} ${detailItem('Deleted By', e.deletedBy)}
            ${detailItem('Delete Reason', e.deleteReason)}`
          : ''}
      </dl>

      <h3 class="section-label">Record Information</h3>
      <dl class="detail-grid detail-grid--audit">
        ${detailItem('Created Date', fmtDateTime(e.createdAt))} ${detailItem('Created By', e.createdBy)}
        ${detailItem('Updated Date', e.updatedAt ? fmtDateTime(e.updatedAt) : 'Not edited')}
        ${detailItem('Updated By', e.updatedBy)}
      </dl>

      ${history && history.length
        ? html`<h3 class="section-label">Change History</h3>
            <ol class="timeline">
              ${history.map((h) => {
                const d = describeHistory(h);
                return html`<li>
                  <div class="timeline-title">${d.title}</div>
                  ${d.text ? html`<div class="timeline-text">${d.text}</div>` : ''}
                  <div class="timeline-meta">${h.performedBy} · ${fmtDateTime(h.performedAt)}</div>
                </li>`;
              })}
            </ol>`
        : ''}
    `
  );

  const manage = canManage() && !e.isDeleted;
  setHtml(
    m.footer,
    html`
      <div class="footer-left">
        ${isAdmin() && !e.isDeleted
          ? html`<button type="button" class="btn btn--danger-ghost" data-act="delete">Delete</button>`
          : ''}
        ${isAdmin() && e.isDeleted ? html`<button type="button" class="btn" data-act="restore">Restore</button>` : ''}
      </div>
      <button type="button" class="btn" data-close>Done</button>
      ${manage && e.status === 'CLOSED' && isAdmin()
        ? html`<button type="button" class="btn" data-act="reopen">Reopen</button>`
        : ''}
      ${manage && e.status === 'OPEN'
        ? html`<button type="button" class="btn" data-act="edit">Edit</button>
            <button type="button" class="btn btn--primary" data-act="close">Close Entry</button>`
        : ''}
    `
  );

  m.footer.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    m.close();
    const actions = {
      edit: () => showEntryForm(e),
      close: () => showCloseDialog(e),
      reopen: () => showReopenDialog(e),
      delete: () => showDeleteDialog(e),
      restore: () => restoreEntry(e),
    };
    actions[act.dataset.act]();
  });
}

// ---------------------------------------------------------------------------
// Add / Edit
// ---------------------------------------------------------------------------

export async function showEntryForm(entry = null) {
  const isEdit = !!entry;
  let lookups;
  let nextCode = '';
  try {
    [lookups, nextCode] = await Promise.all([
      api('GET', '/api/lookups'),
      isEdit ? Promise.resolve(entry.srn) : api('GET', '/api/entries/next-srn').then((r) => r.srn),
    ]);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const m = openModal({ title: isEdit ? `Edit Entry ${entry.srn}` : 'Add Suspense Entry', dismissible: true });
  const quickPicks = state.defaultParticulars;

  setHtml(
    m.body,
    html`<form class="form" novalidate autocomplete="off">
      <div class="form-row">
        <div class="field">
          <label>SRN</label>
          <div class="readonly-value">${nextCode}</div>
          <div class="hint">${isEdit ? 'SRN never changes.' : 'Generated automatically when saved.'}</div>
        </div>
        <div class="field">
          <label for="f-date">Date Given <span class="req">*</span></label>
          <input
            id="f-date"
            name="entryDate"
            type="date"
            required
            max="${state.today}"
            value="${isEdit ? entry.entryDate : state.today}"
          />
          <div class="hint">Date on which the amount was given.</div>
        </div>
      </div>

      <div class="field">
        <label for="f-whom">Whom <span class="req">*</span></label>
        <input
          id="f-whom"
          name="whom"
          type="text"
          maxlength="100"
          list="dl-persons"
          placeholder="Person, employee or vendor name"
          value="${isEdit ? entry.whom : ''}"
        />
        <datalist id="dl-persons">${lookups.persons.map((p) => html`<option value="${p}"></option>`)}</datalist>
        <div class="hint">Start typing to pick an existing name.</div>
      </div>

      <div class="field">
        <label for="f-particulars">What / Particulars <span class="req">*</span></label>
        <input
          id="f-particulars"
          name="particulars"
          type="text"
          maxlength="150"
          list="dl-particulars"
          placeholder="Reason for giving the amount"
          value="${isEdit ? entry.particulars : ''}"
        />
        <datalist id="dl-particulars">
          ${lookups.suggestedParticulars.map((p) => html`<option value="${p}"></option>`)}
        </datalist>
        <div class="chips" role="group" aria-label="Quick pick particulars">
          ${quickPicks.map((p) => html`<button type="button" class="chip" data-pick="${p}">${p}</button>`)}
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label for="f-amount">Amount <span class="req">*</span></label>
          <div class="input-prefix">
            <span aria-hidden="true">₹</span>
            <input
              id="f-amount"
              name="amount"
              type="text"
              inputmode="decimal"
              placeholder="e.g. 500"
              value="${isEdit ? paiseToInput(entry.amountPaise) : ''}"
            />
          </div>
        </div>
        <div class="field"></div>
      </div>

      <div class="field">
        <label for="f-remark">Remark <span class="optional">(optional)</span></label>
        <textarea id="f-remark" name="remark" rows="2" maxlength="500">${isEdit ? entry.remark || '' : ''}</textarea>
      </div>

      <dl class="form-meta" aria-label="Filled in automatically">
        <div><dt>Status</dt><dd>${statusBadge(isEdit ? entry : { status: 'OPEN' })}</dd></div>
        <div><dt>Created By</dt><dd>${isEdit ? entry.createdBy : state.user.displayName}</dd></div>
        <div><dt>Created Date</dt><dd>${isEdit ? fmtDateTime(entry.createdAt) : fmtDate(state.today)}</dd></div>
        ${isEdit
          ? html`<div>
              <dt>Last Updated</dt>
              <dd>${entry.updatedAt ? `${fmtDateTime(entry.updatedAt)} by ${entry.updatedBy}` : 'Not edited yet'}</dd>
            </div>`
          : ''}
      </dl>

      <div class="form-error" role="alert" hidden></div>
      <button type="submit" hidden></button>
    </form>`
  );

  setHtml(
    m.footer,
    html`<button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn btn--primary" data-save>${isEdit ? 'Save Changes' : 'Save Entry'}</button>`
  );

  const form = $('form', m.body);
  const saveBtn = $('[data-save]', m.footer);

  form.addEventListener('click', (ev) => {
    const pick = ev.target.closest('[data-pick]');
    if (!pick) return;
    form.particulars.value = pick.dataset.pick;
    form.amount.focus();
  });

  const submit = async (ev) => {
    if (ev) ev.preventDefault();
    clearFieldErrors(form);
    const values = {
      entryDate: form.entryDate.value,
      whom: form.whom.value.trim(),
      particulars: form.particulars.value.trim(),
      amount: form.amount.value.trim(),
      remark: form.remark.value.trim(),
    };

    if (!values.entryDate) return showFieldError(form, 'entryDate', 'Select the date the amount was given.');
    if (values.entryDate > state.today) return showFieldError(form, 'entryDate', 'Date cannot be in the future.');
    if (!values.whom) return showFieldError(form, 'whom', 'Enter whom the amount was given to.');
    if (!values.particulars) return showFieldError(form, 'particulars', 'Enter what the amount was given for.');
    const paise = parseAmountInput(values.amount);
    if (paise === null || paise <= 0) {
      return showFieldError(form, 'amount', 'Enter a valid amount greater than zero (for example 500 or 1250.50).');
    }

    await withBusy(saveBtn, 'Saving…', async () => {
      try {
        const res = isEdit
          ? await api('PUT', `/api/entries/${entry.id}`, { ...values, version: entry.version })
          : await api('POST', '/api/entries', values);
        m.close();
        const saved = res.entry;
        toast(
          isEdit
            ? `${saved.srn} updated.`
            : `${saved.srn} added — ${fmtMoney(saved.amountPaise)} to ${saved.whom}.`
        );
        refreshView();
      } catch (err) {
        showFieldError(form, err.field, err.message);
        if (err.code === 'VERSION_CONFLICT') refreshView();
      }
    });
  };

  form.addEventListener('submit', submit);
  saveBtn.addEventListener('click', submit);
}

// ---------------------------------------------------------------------------
// Close / settle
// ---------------------------------------------------------------------------

function entrySummaryBox(e) {
  return html`<div class="summary-box">
    <div class="summary-box-row">
      <span class="srn">${e.srn}</span>
      ${statusBadge(e)}
    </div>
    <dl class="summary-box-grid">
      <div><dt>Whom</dt><dd>${e.whom}</dd></div>
      <div><dt>What</dt><dd>${e.particulars}</dd></div>
      <div><dt>Amount</dt><dd class="strong">${fmtMoney(e.amountPaise)}</dd></div>
      <div><dt>Date Given</dt><dd>${fmtDate(e.entryDate)}</dd></div>
      <div><dt>Age</dt><dd>${ageBadge(e)}</dd></div>
    </dl>
  </div>`;
}

export function showCloseDialog(e) {
  const m = openModal({ title: 'Close Suspense Entry' });
  setHtml(
    m.body,
    html`<form class="form" novalidate>
      ${entrySummaryBox(e)}
      <p class="confirm-question">Are you sure you want to close this suspense entry?</p>
      <div class="field">
        <label for="c-remark">Closing Remark <span class="optional">(optional)</span></label>
        <input
          id="c-remark"
          name="closingRemark"
          type="text"
          maxlength="500"
          placeholder="e.g. Bill submitted, balance returned, adjusted in salary"
        />
      </div>
      <p class="hint">
        Closed date will be saved as <strong>${fmtDate(state.today)}</strong> and closed by
        <strong>${state.user.displayName}</strong>. The entry stays in Closed History.
      </p>
      <div class="form-error" role="alert" hidden></div>
      <button type="submit" hidden></button>
    </form>`
  );
  setHtml(
    m.footer,
    html`<button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn btn--primary" data-confirm>Yes, Close Entry</button>`
  );

  const form = $('form', m.body);
  const btn = $('[data-confirm]', m.footer);
  const submit = async (ev) => {
    if (ev) ev.preventDefault();
    clearFieldErrors(form);
    await withBusy(btn, 'Closing…', async () => {
      try {
        const res = await api('POST', `/api/entries/${e.id}/close`, {
          closingRemark: form.closingRemark.value.trim(),
          version: e.version,
        });
        m.close();
        toast(`${res.entry.srn} closed. Moved to Closed History.`);
        refreshView();
      } catch (err) {
        showFieldError(form, err.field, err.message);
        if (err.status === 409) refreshView();
      }
    });
  };
  form.addEventListener('submit', submit);
  btn.addEventListener('click', submit);
}

// ---------------------------------------------------------------------------
// Admin: reopen, delete, restore
// ---------------------------------------------------------------------------

function reasonDialog({ title, intro, entry, label, placeholder, confirmLabel, busyLabel, danger, request, done }) {
  const m = openModal({ title });
  setHtml(
    m.body,
    html`<form class="form" novalidate>
      ${entrySummaryBox(entry)}
      <p class="confirm-question">${intro}</p>
      <div class="field">
        <label for="r-reason">${label} <span class="req">*</span></label>
        <input id="r-reason" name="reason" type="text" maxlength="500" placeholder="${placeholder}" />
      </div>
      <div class="form-error" role="alert" hidden></div>
      <button type="submit" hidden></button>
    </form>`
  );
  setHtml(
    m.footer,
    html`<button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${confirmLabel}</button>`
  );
  const form = $('form', m.body);
  const btn = $('[data-confirm]', m.footer);
  const submit = async (ev) => {
    if (ev) ev.preventDefault();
    clearFieldErrors(form);
    const reason = form.reason.value.trim();
    if (!reason) return showFieldError(form, 'reason', 'Please enter a reason. It is kept in the change history.');
    await withBusy(btn, busyLabel, async () => {
      try {
        await request(reason);
        m.close();
        done();
        refreshView();
      } catch (err) {
        showFieldError(form, err.field, err.message);
      }
    });
  };
  form.addEventListener('submit', submit);
  btn.addEventListener('click', submit);
}

export function showReopenDialog(e) {
  reasonDialog({
    title: 'Reopen Entry',
    intro: 'Reopening moves this entry back to Open and adds it to the Open Amount again.',
    entry: e,
    label: 'Reason for reopening',
    placeholder: 'e.g. Closed by mistake',
    confirmLabel: 'Reopen Entry',
    busyLabel: 'Reopening…',
    request: (reason) => api('POST', `/api/entries/${e.id}/reopen`, { reason }),
    done: () => toast(`${e.srn} reopened.`),
  });
}

export function showDeleteDialog(e) {
  reasonDialog({
    title: 'Delete Entry',
    intro:
      'Deleted entries are removed from all totals and lists but are kept for audit. An administrator can restore them from Manage Entries → Deleted.',
    entry: e,
    label: 'Reason for deleting',
    placeholder: 'e.g. Duplicate of another entry',
    confirmLabel: 'Delete Entry',
    busyLabel: 'Deleting…',
    danger: true,
    request: (reason) => api('POST', `/api/entries/${e.id}/delete`, { reason }),
    done: () => toast(`${e.srn} deleted.`),
  });
}

export function restoreEntry(e) {
  const m = openModal({ title: 'Restore Entry' });
  setHtml(
    m.body,
    html`${entrySummaryBox(e)}
      <p class="confirm-question">Restore ${e.srn}? It will appear in the lists and totals again.</p>`
  );
  setHtml(
    m.footer,
    html`<button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn btn--primary" data-confirm>Restore Entry</button>`
  );
  const btn = $('[data-confirm]', m.footer);
  btn.addEventListener('click', () =>
    withBusy(btn, 'Restoring…', async () => {
      try {
        await api('POST', `/api/entries/${e.id}/restore`, {});
        m.close();
        toast(`${e.srn} restored.`);
        refreshView();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

export function showChangePassword({ forced = false, onDone = () => {}, onLogout = () => {} } = {}) {
  const m = openModal({ title: forced ? 'Set a New Password' : 'Change Password', size: 'sm', dismissible: !forced });
  setHtml(
    m.body,
    html`<form class="form" novalidate>
      ${forced
        ? html`<p class="notice">For security, please replace the temporary password before continuing.</p>`
        : ''}
      <div class="field">
        <label for="p-current">${forced ? 'Temporary / Current Password' : 'Current Password'}</label>
        <input id="p-current" name="currentPassword" type="password" autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="p-new">New Password</label>
        <input id="p-new" name="newPassword" type="password" autocomplete="new-password" />
        <div class="hint">At least 6 characters.</div>
      </div>
      <div class="field">
        <label for="p-confirm">Confirm New Password</label>
        <input id="p-confirm" name="confirmPassword" type="password" autocomplete="new-password" />
      </div>
      <div class="form-error" role="alert" hidden></div>
      <button type="submit" hidden></button>
    </form>`
  );
  setHtml(
    m.footer,
    html`${forced
        ? html`<button type="button" class="btn" data-logout>Logout</button>`
        : html`<button type="button" class="btn" data-close>Cancel</button>`}
      <button type="button" class="btn btn--primary" data-save>Save Password</button>`
  );

  const form = $('form', m.body);
  const btn = $('[data-save]', m.footer);
  const logoutBtn = $('[data-logout]', m.footer);
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      m.close();
      onLogout();
    });
  }

  const submit = async (ev) => {
    if (ev) ev.preventDefault();
    clearFieldErrors(form);
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    if (!currentPassword) return showFieldError(form, 'currentPassword', 'Enter your current password.');
    if (newPassword.length < 6) return showFieldError(form, 'newPassword', 'Password must be at least 6 characters.');
    if (newPassword !== form.confirmPassword.value) {
      return showFieldError(form, 'confirmPassword', 'The two new passwords do not match.');
    }
    await withBusy(btn, 'Saving…', async () => {
      try {
        const res = await api('POST', '/api/auth/change-password', { currentPassword, newPassword });
        m.close();
        toast('Password changed.');
        onDone(res.user);
      } catch (err) {
        showFieldError(form, err.field, err.message);
      }
    });
  };
  form.addEventListener('submit', submit);
  btn.addEventListener('click', submit);
}
