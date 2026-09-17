import { html, setHtml, $ } from '../lib.js';
import { mountEntryList } from '../entry-list.js';
import { CLOSED_COLUMNS } from './dashboard.js';

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Closed History</h1>
          <p class="page-sub">
            Settled or adjusted entries. Closed records are never removed and remain here for audit. Most recently
            closed first.
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
  });

  return { refresh: () => list.reload() };
}
