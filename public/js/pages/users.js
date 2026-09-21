import { html, setHtml, $, api, toast, openModal, fmtDateTime, clearFieldErrors, showFieldError, withBusy } from '../lib.js';
import { state } from '../state.js';

const ROLE_HELP = {
  NORMAL: 'Sees only the money given to them. View only.',
  ENTRY: 'Sees every entry. Can add, edit and record returns. No user management.',
  ADMIN: 'Full access, including users, roles, permissions, reports and settings.',
  MD: 'Full access, including users, roles, permissions, reports and settings.',
};

export function render(main) {
  let users = [];

  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Users</h1>
          <p class="page-sub">
            Everyone signs in with an Employee ID. A person’s <strong>Name</strong> is what staff pick in
            <em>Given To</em> — records given to that name appear in that person’s own view.
          </p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--primary" data-role="add">+ Add User</button>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Logins</h2>
            <div class="panel-sub" data-role="summary"></div>
          </div>
        </div>
        <div data-role="table"><div class="empty">Loading…</div></div>
      </section>`
  );

  function renderTable() {
    const active = users.filter((u) => u.isActive).length;
    $('[data-role="summary"]', main).textContent = `${users.length} logins · ${active} active`;
    setHtml(
      $('[data-role="table"]', main),
      html`<div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Name (Given To)</th>
              <th scope="col">Employee ID</th>
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
                  <span class="whom">${u.displayName}</span>${u.id === state.user.id ? html` <span class="muted">(you)</span>` : ''}
                </td>
                <td data-label="Employee ID"><span class="mono">${u.username}</span></td>
                <td data-label="Role">${u.roleLabel}</td>
                <td data-label="Status">
                  <div>
                    ${u.isActive
                      ? html`<span class="badge badge--closed">Active</span>`
                      : html`<span class="badge badge--deleted">Disabled</span>`}
                    ${u.mustChangePassword ? html`<div class="cell-sub">Must set a new password at next login</div>` : ''}
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
    return { form, modal: m };
  }

  const roleSelect = (current) => html`<select id="u-role" name="role">
    ${state.roles.map((r) => html`<option value="${r.key}" ${r.key === current ? html`selected` : ''}>${r.label}</option>`)}
  </select>
  <div class="hint" data-role="role-help">${ROLE_HELP[current]}</div>`;

  const wireRoleHelp = (form) => {
    const help = $('[data-role="role-help"]', form);
    form.role.addEventListener('change', () => {
      help.textContent = ROLE_HELP[form.role.value];
    });
  };

  function addUser() {
    const { form } = formDialog({
      title: 'Add User',
      saveLabel: 'Create User',
      bodyHtml: html`
        <div class="field">
          <label for="u-name">Name <span class="req">*</span></label>
          <input id="u-name" name="displayName" type="text" maxlength="60" placeholder="e.g. Ashok" />
          <div class="hint">Use the same name staff will pick in Given To. Records given to this name will show up for this person.</div>
        </div>
        <div class="field">
          <label for="u-login">Employee ID <span class="req">*</span></label>
          <input id="u-login" name="username" type="text" maxlength="30" placeholder="e.g. ashok" />
        </div>
        <div class="field">
          <label for="u-role">Role</label>
          ${roleSelect('NORMAL')}
        </div>
        <div class="field">
          <label for="u-pass">Temporary Password <span class="req">*</span></label>
          <input id="u-pass" name="password" type="text" maxlength="128" />
          <div class="hint">At least 6 characters. The person sets their own password at first login.</div>
        </div>`,
      async onSubmit(f) {
        if (!f.displayName.value.trim()) return showFieldError(f, 'displayName', 'Enter the person’s name.') || false;
        if (!f.username.value.trim()) return showFieldError(f, 'username', 'Enter an Employee ID.') || false;
        if (f.password.value.length < 6) return showFieldError(f, 'password', 'Password must be at least 6 characters.') || false;
        const res = await api('POST', '/api/users', {
          displayName: f.displayName.value,
          username: f.username.value,
          role: f.role.value,
          password: f.password.value,
        });
        const linked = res.user.linkedRecords;
        return `${res.user.displayName} added${linked ? ` — ${linked} existing record${linked === 1 ? '' : 's'} linked to them` : ''}.`;
      },
    });
    wireRoleHelp(form);
  }

  function editUser(u) {
    const self = u.id === state.user.id;
    const { form } = formDialog({
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
            Login is enabled
          </label>
          <div class="hint">A disabled login is signed out at once and cannot sign in. Their records are kept.</div>
        </div>
        <p class="hint">A change of role takes effect immediately; the person is signed out and signs in again.</p>`,
      async onSubmit(f) {
        await api('PUT', `/api/users/${u.id}`, {
          displayName: f.displayName.value,
          role: self ? u.role : f.role.value,
          isActive: self ? true : f.isActive.checked,
        });
        return `${u.username} updated.`;
      },
    });
    wireRoleHelp(form);
    if (self) form.role.disabled = true;
  }

  function resetPassword(u) {
    formDialog({
      title: `Reset Password — ${u.username}`,
      saveLabel: 'Reset Password',
      bodyHtml: html`
        <p class="notice">${u.displayName} will be signed out and asked to set a new password at the next login.</p>
        <div class="field">
          <label for="u-pass">Temporary Password</label>
          <input id="u-pass" name="password" type="text" maxlength="128" />
          <div class="hint">At least 6 characters. Share it with the person privately.</div>
        </div>`,
      async onSubmit(f) {
        if (f.password.value.length < 6) return showFieldError(f, 'password', 'Password must be at least 6 characters.') || false;
        await api('POST', `/api/users/${u.id}/reset-password`, { password: f.password.value });
        return `Password reset for ${u.username}.`;
      },
    });
  }

  main.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-role="add"]')) return addUser();
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    const u = users.find((x) => x.id === act.closest('tr').dataset.id);
    if (!u) return;
    if (act.dataset.act === 'edit') editUser(u);
    if (act.dataset.act === 'reset') resetPassword(u);
  });

  load();
  return { refresh: load };
}
