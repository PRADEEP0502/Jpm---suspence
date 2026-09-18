import { html, setHtml, $, api, toast, openModal, fmtDateTime, clearFieldErrors, showFieldError, withBusy } from '../lib.js';
import { state, roleLabel } from '../state.js';

export function render(main) {
  let users = [];

  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Users</h1>
          <p class="page-sub">
            Logins for staff who add, edit and close entries. Viewing the dashboard does not need a login.
          </p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--primary" data-role="add">+ Add User</button>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Entry / Admin Logins</h2>
            <div class="panel-sub">
              <strong>Entry User</strong>: add, edit and close entries. <strong>Administrator</strong>: also reopen,
              delete/restore entries and manage users.
            </div>
          </div>
        </div>
        <div data-role="table"><div class="empty">Loading…</div></div>
      </section>`
  );

  function renderTable() {
    setHtml(
      $('[data-role="table"]', main),
      html`<div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Login ID</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Created</th>
              <th scope="col" class="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(
              (u) => html`<tr data-id="${u.id}" class="${u.isActive ? '' : 'is-inactive'}">
                <td data-label="Name">
                  <span class="whom">${u.displayName}</span>${u.id === state.user.id
                    ? html` <span class="muted">(you)</span>`
                    : ''}
                </td>
                <td data-label="Login ID"><span class="mono">${u.username}</span></td>
                <td data-label="Role">${roleLabel(u.role)}</td>
                <td data-label="Status">
                  <div>
                    ${u.isActive
                      ? html`<span class="badge badge--closed">Active</span>`
                      : html`<span class="badge badge--deleted">Inactive</span>`}
                    ${u.mustChangePassword ? html`<div class="cell-sub">Must set new password at next login</div>` : ''}
                  </div>
                </td>
                <td data-label="Created">${fmtDateTime(u.createdAt)}</td>
                <td class="actions" data-label="Actions">
                  <button type="button" class="btn btn--sm" data-act="edit">Edit</button>
                  <button type="button" class="btn btn--sm" data-act="reset">Reset Password</button>
                </td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>`
    );
  }

  async function load() {
    try {
      users = (await api('GET', '/api/users')).users;
      renderTable();
    } catch (err) {
      setHtml($('[data-role="table"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  function formDialog({ title, bodyHtml, saveLabel, onSubmit }) {
    const m = openModal({ title, size: 'sm' });
    setHtml(
      m.body,
      html`<form class="form" novalidate autocomplete="off">
        ${bodyHtml}
        <div class="form-error" role="alert" hidden></div>
        <button type="submit" hidden></button>
      </form>`
    );
    setHtml(
      m.footer,
      html`<button type="button" class="btn" data-close>Cancel</button>
        <button type="button" class="btn btn--primary" data-save>${saveLabel}</button>`
    );
    const form = $('form', m.body);
    const btn = $('[data-save]', m.footer);
    const submit = async (ev) => {
      if (ev) ev.preventDefault();
      clearFieldErrors(form);
      await withBusy(btn, 'Saving…', async () => {
        try {
          const message = await onSubmit(form);
          if (message === false) return;
          m.close();
          toast(message);
          load();
        } catch (err) {
          showFieldError(form, err.field, err.message);
        }
      });
    };
    form.addEventListener('submit', submit);
    btn.addEventListener('click', submit);
  }

  const roleSelect = (value) => html`<select id="u-role" name="role">
    <option value="ENTRY" ${value !== 'ADMIN' ? html`selected` : ''}>Entry User — add, edit, close</option>
    <option value="ADMIN" ${value === 'ADMIN' ? html`selected` : ''}>Administrator — full access</option>
  </select>`;

  function addUser() {
    formDialog({
      title: 'Add User',
      saveLabel: 'Create User',
      bodyHtml: html`
        <div class="field">
          <label for="u-name">Name</label>
          <input id="u-name" name="displayName" type="text" maxlength="60" placeholder="Shown as Closed By" />
        </div>
        <div class="field">
          <label for="u-login">Login ID</label>
          <input id="u-login" name="username" type="text" maxlength="30" placeholder="e.g. ravi" />
        </div>
        <div class="field">
          <label for="u-role">Role</label>
          ${roleSelect('ENTRY')}
        </div>
        <div class="field">
          <label for="u-pass">Temporary Password</label>
          <input id="u-pass" name="password" type="text" maxlength="128" />
          <div class="hint">At least 6 characters. The user will set their own password at first login.</div>
        </div>`,
      async onSubmit(form) {
        if (!form.displayName.value.trim()) return showFieldError(form, 'displayName', 'Enter the person’s name.') || false;
        if (!form.username.value.trim()) return showFieldError(form, 'username', 'Enter a login ID.') || false;
        if (form.password.value.length < 6) {
          return showFieldError(form, 'password', 'Password must be at least 6 characters.') || false;
        }
        const res = await api('POST', '/api/users', {
          displayName: form.displayName.value,
          username: form.username.value,
          role: form.role.value,
          password: form.password.value,
        });
        return `User ${res.user.username} created.`;
      },
    });
  }

  function editUser(u) {
    const self = u.id === state.user.id;
    formDialog({
      title: `Edit User — ${u.username}`,
      saveLabel: 'Save Changes',
      bodyHtml: html`
        <div class="field">
          <label for="u-name">Name</label>
          <input id="u-name" name="displayName" type="text" maxlength="60" value="${u.displayName}" />
        </div>
        <div class="field">
          <label for="u-role">Role</label>
          ${roleSelect(u.role)} ${self ? html`<div class="hint">You cannot change your own role.</div>` : ''}
        </div>
        <div class="field field--check">
          <label>
            <input type="checkbox" name="isActive" ${u.isActive ? html`checked` : ''} ${self ? html`disabled` : ''} />
            Login is active
          </label>
          <div class="hint">Inactive users cannot log in. Their past entries and history are kept.</div>
        </div>`,
      async onSubmit(form) {
        if (self) form.role.value = u.role;
        await api('PUT', `/api/users/${u.id}`, {
          displayName: form.displayName.value,
          role: form.role.value,
          isActive: self ? true : form.isActive.checked,
        });
        return `User ${u.username} updated.`;
      },
    });
    if (self) {
      const select = document.getElementById('u-role');
      if (select) select.disabled = true;
    }
  }

  function resetPassword(u) {
    formDialog({
      title: `Reset Password — ${u.username}`,
      saveLabel: 'Reset Password',
      bodyHtml: html`
        <p class="notice">
          ${u.displayName} will be logged out and asked to set a new password the next time they log in.
        </p>
        <div class="field">
          <label for="u-pass">Temporary Password</label>
          <input id="u-pass" name="password" type="text" maxlength="128" />
          <div class="hint">At least 6 characters. Share it with the user privately.</div>
        </div>`,
      async onSubmit(form) {
        if (form.password.value.length < 6) {
          return showFieldError(form, 'password', 'Password must be at least 6 characters.') || false;
        }
        await api('POST', `/api/users/${u.id}/reset-password`, { password: form.password.value });
        return `Password reset for ${u.username}.`;
      },
    });
  }

  main.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-role="add"]')) return addUser();
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    const u = users.find((x) => String(x.id) === act.closest('tr').dataset.id);
    if (!u) return;
    if (act.dataset.act === 'edit') editUser(u);
    if (act.dataset.act === 'reset') resetPassword(u);
  });

  load();
  return { refresh: load };
}
