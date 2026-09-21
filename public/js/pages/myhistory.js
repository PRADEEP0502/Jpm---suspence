import { html, setHtml, $ } from '../lib.js';
import { mountEntryList } from '../entry-list.js';

// The user's own entries that have been returned in full. View only.
const MY_HISTORY_COLUMNS = ['srn', 'originalDate', 'particulars', 'amount', 'returnedTotal', 'finalAge', 'closedDate', 'closedBy', 'status'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">My History</h1>
          <p class="page-sub">Your entries that have been returned in full. Click a row to see when and how much was returned.</p>
        </div>
      </div>
      <div data-role="list"></div>`
  );

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'my-history',
    title: () => 'My Closed Entries',
    defaultStatus: 'CLOSED',
    columns: () => MY_HISTORY_COLUMNS,
    dateField: () => 'closed',
    noWhomFilter: true,
    actions: false,
  });

  return { refresh: () => list.reload() };
}
