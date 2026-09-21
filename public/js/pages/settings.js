import { html, setHtml, $, api, fmtDate, fmtDateTime } from '../lib.js';

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

  load();
  return { refresh: load };
}
