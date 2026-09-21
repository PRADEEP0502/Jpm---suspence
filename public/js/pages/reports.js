import { html, setHtml, $, api } from '../lib.js';

// Reports download as CSV files that open in Excel. The server builds them from live data.
export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Reports</h1>
          <p class="page-sub">Download the latest figures as a spreadsheet (CSV, opens in Excel).</p>
        </div>
      </div>
      <div data-role="list" class="report-list"><div class="empty">Loading…</div></div>`
  );

  async function load() {
    try {
      const { reports } = await api('GET', '/api/reports');
      setHtml(
        $('[data-role="list"]', main),
        html`${reports.map(
          (r) => html`<section class="panel report-card">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">${r.title}</h2>
                <div class="panel-sub">${r.description}</div>
              </div>
              <a class="btn btn--primary btn--sm" href="/api/reports/${r.key}.csv" download>Download CSV</a>
            </div>
          </section>`
        )}`
      );
    } catch (err) {
      setHtml($('[data-role="list"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  load();
  return { refresh: load };
}
