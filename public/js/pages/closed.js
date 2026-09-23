import { html, setHtml, $ } from '../lib.js';
import { mountEntryList } from '../entry-list.js';
import { CLOSED_COLUMNS } from './dashboard.js';

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <a class="back-link" href="#/dashboard">← Back to Dashboard</a>
          <h1 class="page-title">Closed History</h1>
          <p class="page-sub">
            Entries whose full amount has been returned. Closed records are never removed. Click an SRN for the complete
            return history.
          </p>
        </div>
      </div>
      <div data-role="list"></div>`
  );

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'closed',
    title: () => 'Closed History',
    defaultStatus: 'CLOSED',
    columns: () => CLOSED_COLUMNS,
    dateField: () => 'closed',
    actions: true,
  });

  return { refresh: () => list.reload() };
}
