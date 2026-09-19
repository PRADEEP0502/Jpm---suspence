# JPM Suspense Amount Dashboard

An internal web application for tracking suspense amounts given to employees or other people, and whether each one is still pending or has been settled.

For every entry it shows **who** received the amount, **what** it was for, **how much**, **when**, its **age** (days pending) and its **status** (Open or Closed). Each entry has a permanent **SRN** (Suspense Reference Number: `SRN-001`, `SRN-002`, …).

- **Anyone** on the office network can open the Dashboard, All Suspense, Closed History and Person Summary (view only, no login).
- **Entry / Admin users** log in to **Add → Edit → Close** entries.

---

## 1. Starting the application

**Requirements**

1. [Node.js](https://nodejs.org) version 20 or newer (LTS) on the computer that will host the dashboard.
2. A MongoDB database — [MongoDB Atlas](https://cloud.mongodb.com) (the free tier is enough) or any MongoDB server.
3. A **`.env`** file next to `server.js` with the connection string. Copy `.env.example` to `.env` and fill it in:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=jpm_suspense
```

> Keep `.env` private — it holds the database password. It is excluded from Git, so it never reaches GitHub.
> In Atlas, open **Network Access** and allow the IP address of the computer that runs the server.

**Easiest (Windows):** double-click **`start-dashboard.bat`**. The first run installs the required packages; after that it starts the server and opens the browser.

**Or from a terminal:**

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

Other office computers can use the **Network** address printed in the server window (e.g. `http://192.168.1.20:3000`). If they cannot connect, allow Node.js / port 3000 through Windows Firewall on the host computer.

> Keep the server window open while people are using the dashboard; closing it stops the application. Every change is saved as soon as it is made, so nothing is lost when it stops.

## 2. First login

| Login ID | Temporary password |
|----------|--------------------|
| `admin`  | `Admin@123`        |

You will be asked to set a new password straight away. After that, open **Users** to create logins for office staff.

## 3. Who can do what

| | View user (no login) | Entry User | Administrator |
|---|:-:|:-:|:-:|
| Dashboard: pending and settled amounts, open entries, aging, search, filters, person-wise and particular-wise summaries | ✓ | ✓ | ✓ |
| All Suspense, Closed History and Person Summary pages (view only) | ✓ | ✓ | ✓ |
| Manage Entries: **Add, Edit, Close** | | ✓ | ✓ |
| Change history of an entry | | ✓ | ✓ |
| Reopen a closed entry, delete/restore an entry (reason required) | | | ✓ |
| Users: create logins, reset passwords, deactivate | | | ✓ |

**Menus:** view users see **Dashboard · All Suspense · Closed History · Person Summary**. Entry users also see **Manage Entries**, and administrators also see **Users**. View users have no Add, Edit, Close or Delete buttons anywhere. **Logout** is at the top right.

## 4. Daily use (Manage Entries)

1. **Add**: click **+ Add Suspense Entry** and fill in the Date Given, Given To, Particulars (type it, or tap a quick-pick such as *Travel*), Amount, and an optional Remark. The **SRN**, Status (**OPEN**), Created By and Created Date are filled in automatically.
2. **Edit**: click **Edit** on an open entry to correct its Date, Given To, Particulars, Amount or Remark. **The SRN never changes.**
3. **Close**: when the amount is settled, click **Close**, add an optional closing remark, and confirm *"Are you sure you want to close this suspense entry?"*. The **Closed Date** (today) and **Closed By** (your name) are saved automatically, and the entry moves to **Closed History**.

In the table, open entries show **Edit** and **Close**; closed entries show **View**. Click any row to see the full record, including created/updated information and the change history.

## 5. Search and filters

- **One search box** finds an SRN, a name (Given To) or particulars. Typing `SRN-001` (or `srn 1`) shows exactly that record; `Ashok` shows all of Ashok's entries; `Stationery` shows all stationery-related entries.
- **All / Open / Closed** switches which entries are listed. The **All Suspense** page lists every entry (open and closed, newest first) with its open and closed totals.
- **Filters** narrow the list further by **Given To**, **Date** (from/to), **Age** group and **Amount** (from/to).
- The Dashboard lists **open entries only** — settled ones live in Closed History, and both together on All Suspense.
- On the Dashboard, clicking a name in the **Person-wise Summary** opens that person’s page, and clicking an **Aging Summary** group lists the open entries in that age range.

## 6. On phones and tablets

The same pages work on any device; the layout adapts to the screen:

- **Wide screens** show the full table.
- **Phones and narrow screens** show one card per entry (SRN and status, then the name, amount, particulars, date and age), because a wide table would otherwise be cut off. A **Sort** box replaces the sortable column headings.
- Summary cards and aging groups become full-width rows on phones, the menu shows every page instead of scrolling sideways, and dialogs open as full-screen sheets with the buttons within thumb reach.
- Printing always uses the full table, whatever the screen size.

## 7. How the figures are calculated

Every figure is calculated from the database each time the page loads. Nothing is hardcoded.

| Figure | Rule |
|--------|------|
| Total Suspense Amount | Sum of all entries (deleted entries excluded) |
| Open Amount / Open Entries | Sum / count where Status = OPEN |
| Closed Amount / Closed Entries | Sum / count where Status = CLOSED |
| Age (open entry) | Today − Entry Date |
| Age / Days Pending (closed entry) | Closed Date − Entry Date (fixed once closed) |

"Today" uses Indian Standard Time, so every computer shows the same age.

**Live updates:** as soon as anyone adds, edits or closes an entry, every open screen updates by itself within about a second — no refreshing. The header shows **Live** while that connection is up, and **Reconnecting…** if it drops (the page still refreshes every minute as a fallback, and reconnects on its own).

**Age groups:**

| Days | Indicator |
|------|-----------|
| 0–7 | Normal |
| 8–15 | Attention |
| 16–30 | Warning |
| 31–60 | Critical |
| more than 60 | Very Critical |

## 8. Data safety and audit

- **Closed entries are never removed.** They stay in Closed History permanently.
- Each entry stores **SRN, Created Date, Created By, Updated Date, Updated By, Closed Date, Closed By and Closing Remark**, plus a change history recording every add, edit and close, with who did it and when.
- Closed entries cannot be edited. If an entry was closed by mistake, an administrator can **Reopen** it (reason required).
- **Delete** is administrator-only, requires a reason, and only hides the entry: it is removed from lists and totals but kept, and can be restored from *Manage Entries → Deleted*. SRNs are never reused.
- If two people edit the same entry at the same moment, the second save is stopped with a message instead of overwriting the first.

**Where data is stored:** in MongoDB — collections `entries`, `users`, `sessions`, `counters` and `audit_log`, in the database named by `MONGODB_DB`.

**Backups:** MongoDB Atlas free clusters have no automatic backups, so the server saves its own copy of everything to `data/backups/backup-<date>.json` once a day while it runs (the last 30 days are kept).

```bash
npm run backup                                          # take a copy right now
npm run restore -- data/backups/backup-2026-09-18.json  # load a copy into an EMPTY database
```

Backups never contain passwords, and a restore refuses to run into a database that already has entries. Paid Atlas plans add automatic point-in-time backups.

## 9. Common tasks

**Forgot the administrator password.** Stop the server, then run:

```bash
npm run reset-password -- admin NewTemp@123
```

Start the server again and log in with the temporary password.

**Remove the sample data before going live.** The four sample entries (SRN-001 to SRN-004) are added only when the database is empty at the first start. Either delete them from Manage Entries (an administrator can delete them; they stay restorable), or start over with a clean database — point `MONGODB_DB` at a new name, or drop the database in Atlas — and start with sample data turned off:

```bat
set SEED_SAMPLE_DATA=false
npm start
```

A clean database also recreates the `admin` / `Admin@123` login, and numbering starts again at SRN-001.

## 10. Settings (optional)

Set these as environment variables before starting the server:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Web port |
| `APP_TIMEZONE` | `Asia/Kolkata` | Time zone used for "today" and age |
| `SEED_SAMPLE_DATA` | `true` | Add the 4 sample entries when a new database is created |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `Admin@123` | First administrator login (new database only) |
| `MONGODB_URI` | (required) | MongoDB connection string — keep it in `.env` |
| `MONGODB_DB` | `jpm_suspense` | Database name inside the cluster |
| `BACKUP_DIR` | `./data/backups` | Folder for the daily backup files |
| `AUTO_BACKUP` | `true` | Set `false` to switch off the daily backup file |
| `BACKUP_KEEP_DAYS` | `30` | Number of daily backups to keep |
| `SESSION_HOURS` | `12` | How long a login stays valid |
| `COOKIE_SECURE` | `false` | Set `true` if the site is served over HTTPS |

---

## Technical reference

**Stack:** Node.js + Express + MongoDB (the official `mongodb` driver). The frontend is plain HTML, CSS and JavaScript modules with no build step.

```
server.js              Express app and API routes
src/config.js          Settings, including reading the .env file
src/db.js              MongoDB connection, indexes and the SRN counter
src/backup.js          Daily backup of the whole database to a JSON file
src/entries.js         SRN generation, entry lifecycle, search/filters, dashboard calculations
src/auth.js            Passwords (scrypt), sessions, permission checks
src/users.js           User management
src/audit.js           Change history
src/util.js            Dates, money parsing, SRN format, age groups
src/seed.js            Sample data
scripts/reset-password.js
scripts/backup.js      npm run backup
scripts/restore.js     npm run restore
public/                Browser application (index.html, css/, js/, js/pages/)
```

### Database

| Table | Purpose |
|-------|---------|
| `entries` | One document per suspense entry: `srnNo` + `srn` (unique, permanent), `entryDate`, `whom`, `particulars`, `amountPaise` (integer paise, which avoids rounding errors), `remark`, `status` (OPEN/CLOSED), `closedDate`, `closedAt`, `closedBy`, `closingRemark`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, soft-delete fields, and `version` (edit-conflict check) |
| `counters` | The SRN running number (`_id: "srn"`) |
| `users` | Logins: `username`, `displayName`, `role` (ADMIN/ENTRY), scrypt `passwordHash`, `mustChangePassword`, `isActive` |
| `sessions` | Active logins (only a SHA-256 hash of the session token is stored; MongoDB deletes them automatically when they expire) |
| `audit_log` | Change history: action, details, performed by, timestamp |

**SRN generation:** an atomic `$inc` on the `counters` document hands each new entry the next number, so simultaneous adds — even from different computers — can never collide. `srn` is that number padded to three digits (`SRN-001`, …, `SRN-999`, `SRN-1000`). Unique indexes on `srn` and `srnNo` are a second guard, and nothing ever changes these fields afterwards.

**Lifecycle:** `OPEN → CLOSED` (Entry User or Administrator; closed date and closed-by set by the server). `CLOSED → OPEN` via Reopen (Administrator, reason required). Soft delete / restore (Administrator, reason required). Each change is applied as a single conditional MongoDB update, so two people acting at the same moment cannot both win.

**Live updates** use a MongoDB change stream plus the app’s own write notifications, pushed to browsers over Server-Sent Events (`GET /api/events`). Changes made by another server — or directly in Atlas/Compass — therefore reach every screen too. If the database does not support change streams (a standalone mongod), the app falls back to its own notifications and the one-minute refresh.

**Indexes** are created at start-up: unique `srn` and `srnNo`, `{isDeleted, status}`, `entryDate`, lower-cased name and particulars (for case-insensitive filters), unique `usernameLower`, and a TTL index that expires old sessions automatically.

**Networks that block SRV lookups:** `mongodb+srv://` needs a DNS SRV record. If the network cannot resolve it, the server retries automatically using public DNS (8.8.8.8 / 1.1.1.1); set `DNS_SERVERS` to use different ones.

### Checking the database connection

Open **http://localhost:3000/api/health** (or `curl` it) at any time:

```json
{ "ok": true, "database": "jpm_suspense", "connected": true, "responseMs": 42, "entries": 4, "liveScreens": 2 }
```

`ok: false` means the server is running but cannot reach MongoDB — check the internet connection, the `MONGODB_URI` in `.env`, and Atlas Network Access.

At start-up the server retries the connection a few times before giving up, and prints a plain-English message saying what to check. Ctrl+C (or closing the window) shuts it down tidily, closing the database connection.

### API (JSON, under `/api`)

| Method & path | Access |
|---------------|--------|
| `GET /health` (database status), `GET /events` (live updates stream), `GET /bootstrap`, `GET /dashboard`, `GET /lookups`, `GET /entries?status=ALL\|OPEN\|CLOSED&q=&whom=&age=&dateFrom=&dateTo=&dateField=entry\|closed&amountMin=&amountMax=`, `GET /entries/:id` | Everyone (read-only) |
| `POST /auth/login`, `POST /auth/logout`, `POST /auth/change-password` | — |
| `GET /entries/next-srn`, `POST /entries`, `PUT /entries/:id`, `POST /entries/:id/close` | Entry User, Administrator |
| `POST /entries/:id/reopen`, `POST /entries/:id/delete`, `POST /entries/:id/restore`, `GET /entries?status=DELETED`, `GET/POST /users`, `PUT /users/:id`, `POST /users/:id/reset-password` | Administrator |

**Security notes:** passwords hashed with scrypt and a per-user salt; HttpOnly SameSite session cookies; write requests must be JSON (blocks cross-site form posts); logins are locked for 5 minutes after 5 failed attempts; temporary passwords must be replaced at first login; all user-entered text is escaped before display; Content-Security-Policy headers are set. For access from outside the office network, put the app behind HTTPS (e.g. a reverse proxy) and set `COOKIE_SECURE=true`.
