'use strict';

/**
 * Emergency password reset (e.g. the only administrator forgot their password).
 *
 *   npm run reset-password -- <login-id> <new-temporary-password>
 *
 * The user is logged out everywhere and must set a new password at the next login.
 */

const db = require('../src/db');
const auth = require('../src/auth');
const audit = require('../src/audit');

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.log('Usage: npm run reset-password -- <login-id> <new-temporary-password>');
    process.exit(1);
  }
  auth.validateNewPassword(password, 'password');

  await db.openDatabase();
  const user = await db.collections.users().findOne({ usernameLower: username.toLowerCase() });
  if (!user) {
    const ids = (await db.collections.users().find({}, { projection: { username: 1 } }).toArray()).map((u) => u.username);
    console.error(`No login ID "${username}". Existing login IDs: ${ids.join(', ') || '(none)'}`);
    await db.closeDatabase();
    process.exit(1);
  }

  await db.collections.users().updateOne(
    { _id: user._id },
    { $set: { passwordHash: auth.hashPassword(password), mustChangePassword: true, isActive: true, updatedAt: new Date() } }
  );
  await db.collections.sessions().deleteMany({ userId: user._id });
  await audit.logAction({
    action: 'USER_PASSWORD_RESET',
    details: { userId: String(user._id), username: user.username, via: 'command line' },
    user: null,
  });

  console.log(`Password reset for "${user.username}". They will be asked to set a new password at next login.`);
  await db.closeDatabase();
}

main().catch(async (err) => {
  console.error(err.message);
  await db.closeDatabase().catch(() => {});
  process.exit(1);
});
