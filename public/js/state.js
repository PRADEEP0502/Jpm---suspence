// Application-wide state shared by pages and dialogs.

export const state = {
  user: null, // { id, username, displayName, role, mustChangePassword } or null for view-only visitors
  today: null, // YYYY-MM-DD in the office time zone (from the server)
  ageBuckets: [],
  defaultParticulars: [],
};

export const isLoggedIn = () => !!state.user;
export const canManage = () => !!state.user && !state.user.mustChangePassword;
export const isAdmin = () => canManage() && state.user.role === 'ADMIN';

export const roleLabel = (role) => (role === 'ADMIN' ? 'Administrator' : 'Entry User');

// The router registers a callback that reloads whatever page is on screen,
// so any dialog can say "data changed" without knowing which page is open.
let refreshCurrentView = () => {};
export const setViewRefresher = (fn) => {
  refreshCurrentView = fn;
};
export const refreshView = () => refreshCurrentView();

export function setToday(today) {
  if (!today || today === state.today) return;
  state.today = today;
  document.dispatchEvent(new CustomEvent('today-changed'));
}
