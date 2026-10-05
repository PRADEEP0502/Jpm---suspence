import { html, setHtml, $, api, fmtDate, fmtDateTime, toast, withBusy } from '../lib.js';

// System information and a backup download. Admin and MD only.
export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-sub">System information and backup.</p>
        </div>
      </div>
      <div data-role="body"><div class="empty">Loading…</div></div>`
  );

  const row = (label, value) => html`<div class="detail-item"><dt>${label}</dt><dd>${value}</dd></div>`;

  async function load() {
    try {
      const s = await api('GET', '/api/system');
      setHtml(
        $('[data-role="body"]', main),
        html`<section class="panel">
            <div class="panel-head"><h2 class="panel-title">System</h2></div>
            <dl class="detail-grid settings-grid">
              ${row('Database', html`${s.database} ${s.connected ? html`<span class="badge badge--closed">Connected</span>` : html`<span class="badge badge--deleted">Not connected</span>`}`)}
              ${row('Response time', s.responseMs != null ? `${s.responseMs} ms` : '—')}
              ${row('Time zone', s.timezone)}
              ${row('Today', fmtDate(s.today))}
              ${row('Entries', s.entries)}
              ${row('Screens open now', s.liveScreens)}
              ${row('Sign-in lasts', `${s.sessionHours} hours`)}
              ${row('Server started', fmtDateTime(s.startedAt))}
              ${row('Version', s.version)}
            </dl>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Money Receivers' Assign</h2>
                <div class="panel-sub">
                  When a Money Receiver presses Assign, their bill goes straight to this person. They do not choose.
                </div>
              </div>
            </div>
            <div class="panel-body">
              <div class="assignee-row">
                <select class="holder-filter" data-role="assignee" aria-label="Bills go to">
                  <option value="">— Nobody (Money Receivers cannot assign) —</option>
                  ${s.employees.map(
                    (u) => html`<option value="${u.id}" ${u.id === s.receiverAssignee ? html`selected` : ''}>
                      ${u.name} — Employee ID: ${u.employeeId}
                    </option>`
                  )}
                </select>
                <button type="button" class="btn btn--primary btn--sm" data-role="save-assignee">Save</button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Backup</h2>
                <div class="panel-sub">
                  Download a copy of every entry, return and login (without passwords). Keep it somewhere safe.
                </div>
              </div>
              <a class="btn btn--primary btn--sm" href="/api/system/backup" download>Download Backup</a>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">Logins by role</h2>
                <div class="panel-sub">Change roles on the Users page.</div>
              </div>
            </div>
            <dl class="detail-grid settings-grid">
              ${s.roles.map((r) => row(r.label, `${s.roleCounts[r.key] || 0} active`))}
            </dl>
          </section>`
      );
    } catch (err) {
      setHtml($('[data-role="body"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  main.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-role="save-assignee"]');
    if (!btn) return;
    const userId = $('[data-role="assignee"]', main).value;
    await withBusy(btn, 'Saving…', async () => {
      try {
        await api('PUT', '/api/system/receiver-assignee', { userId: userId || null });
        const label = $('[data-role="assignee"]', main).selectedOptions[0].textContent.trim().split(' — ')[0];
        toast(userId ? `Money Receivers' bills will now go to ${label}.` : 'Money Receivers can no longer assign.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  load();
  return { refresh: load };
}
