'use strict';

/**
 * Roles and permissions - the single source of truth.
 *
 * The server checks these on every request (src/auth.js). The browser receives the same list
 * for the signed-in user only to decide which buttons and menus to show; hiding a button is
 * never what protects the data.
 *
 *   Role         Own records   All records   Add   Edit   Return   Close   Users / settings
 *   NORMAL       view          no            no    no     no       no      no
 *   ENTRY        yes           YES           yes   yes    yes      yes     no
 *   ADMIN        yes           YES           yes   yes    yes      yes     yes
 *   MD           yes           YES           yes   yes    yes      yes     yes
 *
 * "Close" is not a button of its own: an entry closes automatically the moment its balance
 * reaches zero, so the permission to close is the permission to record a return.
 */

const ROLES = ['NORMAL', 'ENTRY', 'ADMIN', 'MD'];

const ROLE_LABELS = {
  NORMAL: 'Money Receiver',
  ENTRY: 'Money Giver',
  ADMIN: 'Administrator',
  MD: 'Managing Director',
};

const PERMISSIONS = {
  'own:view': 'View own suspense records',
  'entries:viewAll': 'View all suspense entries, search, filters, summaries',
  'entries:add': 'Add new suspense entries',
  'entries:edit': 'Edit entries',
  'entries:return': 'Add return transactions',
  'entries:close': 'Close entries (automatic when the balance reaches zero)',
  'entries:reopen': 'Reopen an entry (undo its last return)',
  'entries:delete': 'Delete / restore entries (soft delete)',
  'reports:view': 'View and download reports',
  'users:manage': 'Create users, assign roles and permissions',
  'system:manage': 'Manage system settings',
};

const ENTRY_PERMISSIONS = [
  'own:view',
  'entries:viewAll',
  'entries:add',
  'entries:edit',
  'entries:return',
  'entries:close',
];

const FULL_PERMISSIONS = [...ENTRY_PERMISSIONS, ...Object.keys(PERMISSIONS).filter((p) => !ENTRY_PERMISSIONS.includes(p))];

const ROLE_PERMISSIONS = {
  NORMAL: ['own:view'],
  ENTRY: ENTRY_PERMISSIONS,
  ADMIN: FULL_PERMISSIONS,
  MD: FULL_PERMISSIONS,
};

const permissionsFor = (role) => [...(ROLE_PERMISSIONS[role] || [])];
const can = (user, permission) => !!user && permissionsFor(user.role).includes(permission);
const isRole = (value) => ROLES.includes(value);

/** Where each role lands after login. */
const HOME_FOR_ROLE = { NORMAL: '#/my', ENTRY: '#/dashboard', ADMIN: '#/dashboard', MD: '#/dashboard' };

module.exports = { ROLES, ROLE_LABELS, PERMISSIONS, ROLE_PERMISSIONS, HOME_FOR_ROLE, permissionsFor, can, isRole };
