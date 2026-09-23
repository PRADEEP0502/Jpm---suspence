# JPM Suspense Amount Dashboard

An internal web application that tracks suspense amounts given to people, records partial and full returns, and keeps a complete history. Everyone signs in; what each person can see and do depends on their role. Data is stored in MongoDB.

## Roles

| Role | Sees | Can do |
| --- | --- | --- |
| **Normal User** | Only their own records and return history | View only |
| **Entry User** | All records | Add, edit, add returns (closing is automatic). No user management |
| **Administrator** | Everything | Everything, plus Users, Permissions, Reports, Settings |
| **Managing Director** | Everything | Same as Administrator |

Permissions are enforced on the server for every API request and in every database query, not only hidden on screen. For example a Normal User calling `GET /api/suspense?userId=someone-else` gets `403`, and no API response, search, filter or summary ever contains another person's records. The whole matrix is in [src/permissions.js](src/permissions.js) and is shown on the Permissions page.

Records are linked to a login by the **Given To** name: the name on an entry must match a user's Name. Entries created before a login exists are linked automatically when the login is created or renamed.

## Menus

- Normal User: My Suspense, My History, Profile, Logout
- Entry User: Dashboard, All Suspense, Add Entry, Closed History, Person Summary, Logout
- Administrator / MD: the above plus Users, Permissions, Reports, Settings

## How suspense entries work

- **SRN** (SRN-001, SRN-002 ...) is generated automatically and never changes.
- **Original Amount** is never overwritten. **Balance = Original - Total Returned.**
- An entry can have many returns (date, returned by, amount, remark).
- Status is automatic: **Open** (nothing returned), **Partially Settled** (some returned), **Closed** (balance zero).
- There is no manual close. When the final return brings the balance to zero the entry closes automatically; the closed date is the final return date and the final age is stored.
- A return larger than the balance is rejected: "Returned amount cannot be greater than the remaining balance of ₹200."
- Edit cannot set the Original Amount below what has already been returned.
- Every add, edit, return, reopen and delete is recorded in an audit trail.

## Dashboard

Five cards from live database totals: Open Amount, Partially Settled Amount, Closed Amount, Open Entries, Partially Settled Entries. Each card is clickable and opens the exact entries behind that figure. Under them an Aging Summary (0-7, 8-15, 16-30, 31-60, 60+ days), the pending table, and person-wise and particulars summaries. Closed entries are in Closed History; All Suspense lists everything with filters.

## Reports

Administrators and the MD can download CSV files (open in Excel): all suspense, return history, person-wise summary and aging summary.

## Run it locally

Requires Node.js 20+ and a MongoDB database.

```
npm install
```

Create a `.env` file (never commit it):

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?appName=Cluster0
MONGODB_DB=jpm_suspense
```

```
npm start
```

Open http://localhost:3000.

- The first administrator is created on first start: login `admin`, password `Admin@123`. You must set a new password at first sign-in.
- On an empty database, sample data is added: entries SRN-001, SRN-002, SRN-003 and sample users `ashok`, `vanitha`, `jaya` (Normal Users, password `Welcome@123`, must change at first login). A database that already has entries is left untouched.
- Administrators create the other logins under Users. Employee ID is the login name.

## Settings

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (required) |
| `MONGODB_DB` | Database name (default `jpm_suspense`) |
| `APP_TIMEZONE` | Time zone for dates and ages (default `Asia/Kolkata`) |
| `COOKIE_SECURE` | `true` behind HTTPS (set on Render) |
| `AUTO_BACKUP` | Automatic backups on/off |

## Deploy

[render.yaml](render.yaml) describes the Render service. Set `MONGODB_URI` and `MONGODB_DB` in Render and allow Render in the Atlas Network Access list. Render redeploys on every push to `main`. `GET /api/health` is the only public endpoint.

## Notes when upgrading from the earlier public-view version

- The dashboard is no longer public: everyone must sign in.
- Existing entries are linked to a login only when a user with the same name exists. Create user logins named after the people in **Given To** and their records appear in My Suspense.
- Sample logins are created only on a fresh, empty database.
