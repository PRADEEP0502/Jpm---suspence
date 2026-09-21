import { html, setHtml, $ } from '../lib.js';
import { state } from '../state.js';
import { showChangePassword } from '../dialogs.js';

const ACCESS_TEXT = {
  NORMAL: 'You can view the suspense amounts given to you and their return history. You cannot add or change anything.',
  ENTRY: 'You can view every suspense entry, add entries, edit them and record returns. User management is handled by an Administrator or MD.',
  ADMIN: 'Full access: all entries, returns, users, roles, permissions, reports and settings.',
  MD: 'Full access: all entries, returns, users, roles, permissions, reports and settings.',
};

export function render(main) {
  const u = state.user;
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Profile</h1>
          <p class="page-sub">Your sign-in details.</p>
        </div>
      </div>
      <section class="panel profile-card">
        <dl class="detail-grid">
          <div class="detail-item"><dt>Name</dt><dd>${u.displayName}</dd></div>
          <div class="detail-item"><dt>Employee ID</dt><dd>${u.username}</dd></div>
          <div class="detail-item"><dt>Role</dt><dd>${u.roleLabel}</dd></div>
          <div class="detail-item detail-item--wide"><dt>Your access</dt><dd>${ACCESS_TEXT[u.role]}</dd></div>
        </dl>
        <div class="panel-body">
          <button type="button" class="btn btn--primary" data-role="change">Change Password</button>
        </div>
      </section>`
  );
  $('[data-role="change"]', main).addEventListener('click', () => showChangePassword());
  return { refresh() {} };
}
