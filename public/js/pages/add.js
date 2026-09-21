import { render as renderAll } from './all.js';
import { showEntryForm } from '../dialogs.js';

// "Add Entry" in the menu: the Add Suspense Entry form opens straight away, over the list of all entries.
export function render(main) {
  const view = renderAll(main);
  showEntryForm();
  return view;
}
