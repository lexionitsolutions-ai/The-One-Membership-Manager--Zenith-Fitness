# Six-sheet fallback and Supabase fingerprint sync

Supabase is the primary database and the only ID authority. Forms never fall back
to writing Sheets when Supabase is unavailable. Sheets is a readable recovery
snapshot; it does not allocate IDs, control device access, or import edits back.
Keep the old workbook as an archive. This setup never deletes its tabs.

## 1. Database setup

After migration 007, run `supabase/migrations/202610270008_secondary_sync.sql` in
Supabase SQL Editor as postgres. Run
`supabase/tests/secondary_sync_smoke.sql` next. That test rolls back everything
and does not contact Google or the device. If a test fails, run `ROLLBACK;`.

The counter starts at **at least 660**, or the highest existing regular device/ZF
ID if larger. Run migration `009_reserved_team_ids.sql` and its rollback-only
`reserved_team_ids_smoke.sql` test after 008. IDs **2985–2996** are reserved for
the twelve Team Zenith members provided by the owner. They do not advance the
regular admission counter, and allocation skips them if admissions later reach
that range. Thus the next admission is ZF-661/device ID 661 only if no higher
regular IDs already exist. New admissions use a locked, persistent Supabase counter.
Retries reuse the original admission. Renewals keep the same member/device ID.
Imported higher IDs are checked again when allocating. Deleting a member cannot
rewind the counter. The fingerprint ID range remains 1–65535.

## 2. Create the new workbook

In a standalone Google Apps Script project, paste
`apps-script/create-fallback-workbook.gs`. Run `createZenithFallbackWorkbook` and
authorize your Google account. Copy the new URL/ID from the execution log.
No Web App deployment or public endpoint is needed. Running it again reuses the
workbook created by this script, rather than creating another copy.

The six tabs are:

| Tab | Columns / meaning |
| --- | --- |
| Admissions | ID, NAME, CNUMBER, PLAN, START DATE, END DATE, AMOUNT PAID, PENDING AMOUNT, PAYMENT MODE, PAYMENT STATUS, WHATSAPP MESSAGE, LINK |
| Renewals | Same 12 columns; one row per renewal transaction |
| Database | ID, NAME, END DATE — all members, latest confirmed expiry, including archived member IDs |
| System Control | SETTING, VALUE — includes LastAdmissionID, copied from Supabase |
| Daily Cash Book | DATE, DESCRIPTION, TRANSACTION TYPE, AMOUNT, PAYMENT MODE |
| Renewal List | ID, NAME, END DATE — non-archived members and their latest confirmed expiry, sorted by expiry |

“AMOUNT PAID” is one column. It contains verified payments plus reconciled opening
payments. Unknown historical balances are marked Needs review, never invented.
Dates are unambiguous `YYYY-MM-DD`, in India time. Every cashbook receipt occupies
one row. Cash + Online payments produce two rows, avoiding double counting.
Refunds are negative cashbook entries. Opening payments are not added again as
cashbook receipts when the imported cashbook already contains them.

Renewal List is a current expiry list, not a copy of renewal transactions. After
a renewal, that member’s latest end date updates in both Database and Renewal
List. Admissions and Renewals preserve confirmed period history. Cancelled
periods are excluded; their payment/refund history remains in the cashbook.

This six-tab format is a selected operational fallback, **not a complete database
backup**: enquiries, attendance, staff accounts, private details, expenses and full
PT contracts remain in Supabase. PT receipts are included in the cashbook. Jobs
for enquiry mirroring are not falsely marked completed by the six-tab worker.
Use Supabase backups separately if full recovery is required.

## 3. Connect Google Sheets

Sign into the local dashboard as admin. Under **Activity & sync → Preview sync &
settings**, find the service-account email. Share the NEW workbook with this
email as **Editor**. Do not share or paste the private credentials file.

Add these lines to the project’s `.env` (keep the existing Supabase lines):

```dotenv
FALLBACK_SPREADSHEET_ID=PASTE_NEW_SPREADSHEET_ID_HERE
SUPABASE_DEVICE_SYNC_ENABLED=0
```

The Google Sheets API must be enabled for the service account’s Google project.
The existing `gym-access-system/credentials.json` is used. An optional
`GOOGLE_CREDENTIALS_FILE` can select another local credentials file.

Restart the local server (`npm.cmd run start:dashboard`), sign in again, preview
the counts and last ID, then click **Sync fallback workbook**. Import the prepared
existing-member snapshot first if the Supabase member list is still empty.

Only the new workbook is written. The worker validates all six headers and the
gym/schema markers before any write. One atomic batch replaces the projections;
retries never append duplicate admissions, renewals or receipts. Data is written
as literal text/numbers, so a name beginning with `=` is not a formula.
Manual edits in these fallback tabs will be overwritten by the next sync.

## 4. Enable fingerprint delivery

For a manual sync, open **Activity & sync → Membership access sync**, choose
**Today** or **Tomorrow**, preview the selected date, then click **Sync memberships
for selected date**. This processes all mapped Supabase members, not only the
next ten queued jobs. It is an authenticated admin action and can run while
automatic device delivery is disabled. Selecting tomorrow applies tomorrow's
allow/restrict decisions immediately; it is not a scheduled job. Team IDs remain
untouched. The selected date is retained in `DEVICE_ACCESS_DATE` so an enabled
background worker cannot immediately replace it with today's policy. Use Today
and sync again to restore today's access. Expired date overrides are ignored.

All start commands now default to port **3001** unless `PORT` is explicitly set.
Open `http://localhost:3001/dashboard/` for these controls.

Confirm the ID mappings in the preview. Set the current device address and enable
the bridge in `.env`:

```dotenv
DEVICE_IP=YOUR_CURRENT_DEVICE_IP
DEVICE_PORT=4370
SUPABASE_DEVICE_SYNC_ENABLED=1
```

Restart the server and sign in. **Sync fingerprint batch** processes up to ten
queued jobs. Further batches run automatically every 15 seconds while a staff
session is active; an offline device leaves jobs failed for retry. Network/device
timeouts can make a batch take longer. Old queued admissions/renewals are given
priority over daily expiry checks. Daily checks are queued once per India day.

For a first real admission, verify the returned admission ID against Database,
System Control and the physical device user list. Fingerprint enrollment itself
still occurs at the device. The bridge never deletes/re-enrolls templates.

The same Supabase `device_user_id` is used as both device UID and user ID. A UID
conflict stops the batch before modifying users. Name changes preserve the
existing password, role and card number. Access is allowed when **any** confirmed
gym membership covers today; future renewals cannot hide a current active period.
Archived/inactive mapped members are restricted. Unrelated device users are not
modified. PT alone does not grant general gym membership access.

Team Zenith IDs 2985–2996 are protected: the bridge does not rename their device
accounts, change their access or require a paid membership. They are included in
the Database fallback tab and excluded from the Renewal List. The reservation
list does not create staff login accounts or change application permissions.

## Delivery and testing limits

No service-role key, account password or Supabase token is written into Apps
Script/Sheets. The bridge uses the signed-in staff session on the local server.
It refreshes that session’s access token while the 12-hour staff session remains
valid. After expiry/sign-out/server shutdown, queued jobs wait until sign-in.
This is not an always-on cloud worker; keep this local app running during gym
hours. The database lease prevents concurrent bridge writers and recovers jobs
after a worker crash. A failed delivery never rolls back a successfully saved
admission or payment.

Legacy `/admission-submit`, `/device/add-user`, `/sync-access` and
`/admin/sync-members` writes now return HTTP 410. The server no longer starts the
old Sheets-based device/attendance loops. Retire any separately running old
server processes or Apps Script submission deployments. The old source workbook
is an archive, not an active source for the new app.

Run `npm.cmd run test:dashboard` and `npm.cmd run test:secondary` for local tests.
These use mocked Google/device services and cover projections, payment splits,
renewal expiry changes, literal cell values, wrong-workbook/header rejection,
retry/failure handling, device mapping conflicts and access periods. The SQL
smoke test must be run in Supabase. Real Google permissions and fingerprint
connectivity must be verified after configuring the new workbook/device.

API design references: [Google atomic batch requests](https://developers.google.com/workspace/sheets/api/guides/batch),
[Apps Script SpreadsheetApp](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app).
