'use strict';

/**
 * Emergency password reset (e.g. the only administrator forgot their password).
 *
 *   1. Stop the dashboard server first (close its window / Ctrl+C).
 *   2. npm run reset-password -- <login-id> <new-temporary-password>
 *   3. Start the server again. The user must set a new password at next login.
 */

const db = require('../src/db');
const auth = require('../src/auth');
const audit = require('../src/audit');
const { nowTimestamp } = require('../src/util');

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.log('Usage: npm run reset-password -- <login-id> <new-temporary-password>');
    process.exit(1);
  }
  auth.validateNewPassword(password, 'password');

  await db.openDatabase();
  const user = db.get('SELECT * FROM users WHERE username = @u COLLATE NOCASE', { u: username });
  if (!user) {
    const ids = db.all('SELECT username FROM users').map((u) => u.username);
    console.error(`No login ID "${username}". Existing login IDs: ${ids.join(', ') || '(none)'}`);
    process.exit(1);
  }

  db.transaction(() => {
    db.run(
      `UPDATE users SET password_hash = @hash, must_change_password = 1, is_active = 1, updated_at = @now
        WHERE id = @id`,
      { hash: auth.hashPassword(password), now: nowTimestamp(), id: user.id }
    );
    db.run('DELETE FROM sessions WHERE user_id = @id', { id: user.id });
    audit.logAction({
      action: 'USER_PASSWORD_RESET',
      details: { userId: user.id, username: user.username, via: 'command line' },
      user: null,
    });
  });

  console.log(`Password reset for "${user.username}". They will be asked to set a new password at next login.`);
  console.log('You can start the server again now.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
