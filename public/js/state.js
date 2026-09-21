// Application-wide state shared by pages and dialogs.

export const state = {
  user: null, // { id, username, displayName, role, roleLabel, permissions[], home, mustChangePassword }
  today: null, // YYYY-MM-DD in the office time zone (from the server)
  ageBuckets: [],
  defaultParticulars: [],
  roles: [], // [{ key, label }]
};

export const isLoggedIn = () => !!state.user;

/**
 * Does the signed-in user have this permission? The list comes from the server, and it is only used
 * to decide what to SHOW. The server checks the same permission again on every request.
 */
export const can = (permission) =>
  !!state.user && !state.user.mustChangePassword && state.user.permissions.includes(permission);

export const canSeeAll = () => can('entries:viewAll');
export const roleLabel = (role) => (state.roles.find((r) => r.key === role) || {}).label || role;

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
