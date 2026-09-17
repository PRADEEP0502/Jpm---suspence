# JPM Suspense Amount Dashboard

An internal web application for tracking suspense amounts given to employees or other people, and whether each one is still pending or has been settled.

For every entry it shows **who** received the amount, **what** it was for, **how much**, **when**, its **age** (days pending) and its **status** (Open or Closed). Each entry has a permanent **SRN** (Suspense Reference Number: `SRN-001`, `SRN-002`, …).

- **Anyone** on the office network can open the Dashboard, Closed History and Person Summary (view only, no login).
- **Entry / Admin users** log in to **Add → Edit → Close** entries.

---

## 1. Starting the application

**Requirement:** [Node.js](https://nodejs.org) version 20 or newer (LTS) on the computer that will host the dashboard.

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
| Dashboard: totals, open entries, search, filters, person-wise and particular-wise summaries | ✓ | ✓ | ✓ |
| Closed History and Person Summary pages (view only) | ✓ | ✓ | ✓ |
| Manage Entries: **Add, Edit, Close** | | ✓ | ✓ |
| Change history of an entry | | ✓ | ✓ |
| Reopen a closed entry, delete/restore an entry (reason required) | | | ✓ |
| Users: create logins, reset passwords, deactivate | | | ✓ |

**Menus:** view users see **Dashboard · Closed History · Person Summary**. Entry users also see **Manage Entries**, and administrators also see **Users**. View users have no Add, Edit, Close or Delete buttons anywhere. **Logout** is at the top right.

## 4. Daily use (Manage Entries)

1. **Add**: click **+ Add Suspense Entry** and fill in the Date, Whom, What / Particulars (type it, or tap a quick-pick such as *Travel*), Amount, and an optional Remark. The **SRN**, Status (**OPEN**), Created By and Created Date are filled in automatically.
2. **Edit**: click **Edit** on an open entry to correct its Date, Whom, Particulars, Amount or Remark. **The SRN never changes.**
3. **Close**: when the amount is settled, click **Close**, add an optional closing remark, and confirm *"Are you sure you want to close this suspense entry?"*. The **Closed Date** (today) and **Closed By** (your name) are saved automatically, and the entry moves to **Closed History**.

In the table, open entries show **Edit** and **Close**; closed entries show **View**. Click any row to see the full record, including created/updated information and the change history.

## 5. Search and filters

- **One search box** finds an SRN, a name (Whom) or particulars. Typing `SRN-001` (or `srn 1`) shows exactly that record; `Ashok` shows all of Ashok's entries; `Stationery` shows all stationery-related entries.
- **All / Open / Closed** switches which entries are listed.
- **Filters** narrow the list further by **Whom**, **Date** (from/to), **Age** group and **Amount** (from/to).
- On the Dashboard, clicking a name in the **Person-wise Summary** lists that person's entries, and clicking an **Aging Summary** group lists the open entries in that age range.

## 6. How the figures are calculated

Every figure is calculated from the database each time the page loads. Nothing is hardcoded.

| Figure | Rule |
|--------|------|
| Total Suspense Amount | Sum of all entries (deleted entries excluded) |
| Open Amount / Open Entries | Sum / count where Status = OPEN |
| Closed Amount / Closed Entries | Sum / count where Status = CLOSED |
| Age (open entry) | Today − Entry Date |
| Age / Days Pending (closed entry) | Closed Date − Entry Date (fixed once closed) |

"Today" uses Indian Standard Time. Pages refresh automatically every minute, so ages increase each day and changes made by other staff appear without reloading.

**Age groups:**

| Days | Indicator |
|------|-----------|
| 0–7 | Normal |
| 8–15 | Attention |
| 16–30 | Warning |
| 31–60 | Critical |
| more than 60 | Very Critical |

## 7. Data safety and audit

- **Closed entries are never removed.** They stay in Closed History permanently.
- Each entry stores **SRN, Created Date, Created By, Updated Date, Updated By, Closed Date, Closed By and Closing Remark**, plus a change history recording every add, edit and close, with who did it and when.
- Closed entries cannot be edited. If an entry was closed by mistake, an administrator can **Reopen** it (reason required).
- **Delete** is administrator-only, requires a reason, and only hides the entry: it is removed from lists and totals but kept, and can be restored from *Manage Entries → Deleted*. SRNs are never reused.
- If two people edit the same entry at the same moment, the second save is stopped with a message instead of overwriting the first.

**Where data is stored:** `data/suspense.sqlite` (a single database file).
**Backups:** a copy is saved automatically once a day in `data/backups/` (the last 30 days are kept). To back up manually, copy the `data` folder. To restore, stop the server and replace `data/suspense.sqlite` with a backup copy.

## 8. Common tasks

**Forgot the administrator password.** Stop the server, then run:

```bash
npm run reset-password -- admin NewTemp@123
```

Start the server again and log in with the temporary password.

**Remove the sample data before going live.** The four sample entries (SRN-001 to SRN-004) are added only when the database is first created. To start with an empty database: stop the server, delete the `data` folder, and start again with sample data turned off:

```bat
set SEED_SAMPLE_DATA=false
npm start
```

This also resets logins back to `admin` / `Admin@123`, and numbering starts again at SRN-001.

## 9. Settings (optional)

Set these as environment variables before starting the server:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Web port |
| `APP_TIMEZONE` | `Asia/Kolkata` | Time zone used for "today" and age |
| `SEED_SAMPLE_DATA` | `true` | Add the 4 sample entries when a new database is created |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `Admin@123` | First administrator login (new database only) |
| `DATA_DIR` | `./data` | Folder for the database and backups |
| `BACKUP_KEEP_DAYS` | `30` | Number of daily backups to keep |
| `SESSION_HOURS` | `12` | How long a login stays valid |
| `COOKIE_SECURE` | `false` | Set `true` if the site is served over HTTPS |

---

## Technical reference

**Stack:** Node.js + Express. SQLite via [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly, so no C++ build tools are needed on Windows). The frontend is plain HTML, CSS and JavaScript modules with no build step.

```
server.js              Express app and API routes
src/db.js              SQLite storage, schema and upgrades, atomic saves, daily backups
src/entries.js         SRN generation, entry lifecycle, search/filters, dashboard calculations
src/auth.js            Passwords (scrypt), sessions, permission checks
src/users.js           User management
src/audit.js           Change history
src/util.js            Dates, money parsing, SRN format, age groups
src/seed.js            Sample data
scripts/reset-password.js
public/                Browser application (index.html, css/, js/, js/pages/)
```

### Database

| Table | Purpose |
|-------|---------|
| `entries` | One row per suspense entry: `srn_no` + `srn` (unique, permanent), `entry_date`, `whom`, `particulars`, `amount_paise` (integer paise, which avoids rounding errors), `remark`, `status` (OPEN/CLOSED), `closed_date`, `closed_at`, `closed_by`, `closing_remark`, `created_at`, `created_by`, `updated_at`, `updated_by`, soft-delete fields, and `version` (edit-conflict check) |
| `users` | Logins: `username`, `display_name`, `role` (ADMIN/ENTRY), scrypt `password_hash`, `must_change_password`, `is_active` |
| `sessions` | Active logins (only a SHA-256 hash of the session token is stored) |
| `audit_log` | Change history: action, JSON details, performed by, timestamp |

**SRN generation:** inside the same database transaction as the insert, `srn_no = MAX(srn_no) + 1` (deleted rows included) and `srn = 'SRN-' + srn_no` padded to three digits (`SRN-001`, …, `SRN-999`, `SRN-1000`). Unique constraints on both columns guarantee no duplicates. Nothing ever updates these columns afterwards.

**Lifecycle:** `OPEN → CLOSED` (Entry User or Administrator; closed date and closed-by set by the server). `CLOSED → OPEN` via Reopen (Administrator, reason required). Soft delete / restore (Administrator, reason required). A database constraint ensures an OPEN entry has no closed date and a CLOSED entry always has one.

**Upgrades:** the schema version is stored in the database and upgrades run automatically at start-up. A copy is saved to `data/backups/suspense-before-upgrade-v<N>-<date>.sqlite` first. Version 2 converted earlier `ST-001`-style numbers to `SRN-001` while keeping each entry's number and history.

### API (JSON, under `/api`)

| Method & path | Access |
|---------------|--------|
| `GET /bootstrap`, `GET /dashboard`, `GET /lookups`, `GET /entries?status=ALL\|OPEN\|CLOSED&q=&whom=&age=&dateFrom=&dateTo=&dateField=entry\|closed&amountMin=&amountMax=`, `GET /entries/:id` | Everyone (read-only) |
| `POST /auth/login`, `POST /auth/logout`, `POST /auth/change-password` | — |
| `GET /entries/next-srn`, `POST /entries`, `PUT /entries/:id`, `POST /entries/:id/close` | Entry User, Administrator |
| `POST /entries/:id/reopen`, `POST /entries/:id/delete`, `POST /entries/:id/restore`, `GET /entries?status=DELETED`, `GET/POST /users`, `PUT /users/:id`, `POST /users/:id/reset-password` | Administrator |

**Security notes:** passwords hashed with scrypt and a per-user salt; HttpOnly SameSite session cookies; write requests must be JSON (blocks cross-site form posts); logins are locked for 5 minutes after 5 failed attempts; temporary passwords must be replaced at first login; all user-entered text is escaped before display; Content-Security-Policy headers are set. For access from outside the office network, put the app behind HTTPS (e.g. a reverse proxy) and set `COOKIE_SECURE=true`.
