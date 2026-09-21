import { html, setHtml, $, api } from '../lib.js';

// What each role can do, shown as the table from the requirements. It is read from the server,
// which is the very list it enforces, so this screen can never disagree with what is allowed.
const COLUMNS = [
  ['Own Records', (p) => (p.includes('entries:viewAll') ? 'Yes' : p.includes('own:view') ? 'View' : 'No')],
  ['All Records', (p) => (p.includes('entries:viewAll') ? 'YES' : 'No')],
  ['Add', (p) => (p.includes('entries:add') ? 'Yes' : 'No')],
  ['Edit', (p) => (p.includes('entries:edit') ? 'Yes' : 'No')],
  ['Return', (p) => (p.includes('entries:return') ? 'Yes' : 'No')],
  ['Close', (p) => (p.includes('entries:close') ? 'Yes (automatic at zero balance)' : 'No')],
  ['User Management', (p) => (p.includes('users:manage') ? 'Yes' : 'No')],
];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Permissions</h1>
          <p class="page-sub">
            What each role can do. To give someone entry rights, change their role on the <a href="#/users">Users</a> page.
          </p>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Role permissions</h2></div>
        <div data-role="matrix"><div class="empty">Loading…</div></div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Full list of permissions</h2>
            <div class="panel-sub">Every action is checked on the server for every request, not just hidden on screen.</div>
          </div>
        </div>
        <div data-role="detail"></div>
      </section>`
  );

  async function load() {
    try {
      const sys = await api('GET', '/api/system');
      const cell = (v) => {
        const yes = v.startsWith('Y');
        return html`<td class="perm ${yes ? 'perm--yes' : 'perm--no'}">${v}</td>`;
      };
      setHtml(
        $('[data-role="matrix"]', main),
        html`<div class="table-wrap">
          <table class="data-table perm-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col" class="num">Logins</th>
                ${COLUMNS.map(([label]) => html`<th scope="col">${label}</th>`)}
              </tr>
            </thead>
            <tbody>
              ${sys.roles.map(
                (r) => html`<tr>
                  <th scope="row">${r.label}</th>
                  <td class="num">${sys.roleCounts[r.key] || 0}</td>
                  ${COLUMNS.map(([, fn]) => cell(fn(r.permissions)))}
                </tr>`
              )}
            </tbody>
          </table>
        </div>`
      );
      setHtml(
        $('[data-role="detail"]', main),
        html`<div class="table-wrap">
          <table class="data-table data-table--compact perm-table">
            <thead>
              <tr>
                <th scope="col">Permission</th>
                ${sys.roles.map((r) => html`<th scope="col" class="num">${r.label}</th>`)}
              </tr>
            </thead>
            <tbody>
              ${Object.entries(sys.permissions).map(
                ([key, text]) => html`<tr>
                  <td>${text}</td>
                  ${sys.roles.map(
                    (r) => html`<td class="num perm ${r.permissions.includes(key) ? 'perm--yes' : 'perm--no'}">${
                      r.permissions.includes(key) ? '✓' : '—'
                    }</td>`
                  )}
                </tr>`
              )}
            </tbody>
          </table>
        </div>`
      );
    } catch (err) {
      setHtml($('[data-role="matrix"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  load();
  return { refresh: load };
}
