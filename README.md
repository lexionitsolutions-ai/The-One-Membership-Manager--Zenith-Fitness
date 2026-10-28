# Zenith Fitness Membership Manager

Gym operations app with Supabase as the primary database, six-sheet Google Sheets
fallback, and a local fingerprint-device bridge.

## Run locally

Requires Node.js 24 or later and Python 3 for import validation tests.

```powershell
npm ci
```

Copy `.env.example` to `.env` and configure your own Supabase project, server
secret, gym, device and fallback spreadsheet. Never commit `.env` or the Google
service-account credential file. Apply the SQL migrations in numeric order; use
the staff setup instructions to link the first administrator.

```powershell
npm start
```

Open `http://localhost:3001/dashboard/`, `/forms/index.html` or `/fingerprint/`.
The Windows `Start-Finger-Admission.bat` launcher opens fingerprint sync.

## Included workflows

- Admission and renewal forms save directly to Supabase, with retry protection,
  pending amounts, Cash + Online splits and custom package durations.
- Member corrections, membership extensions, PT packages and trainer selection.
- Enquiries, lead follow-ups, expired-member reviews and staff management.
- Admin overview, Daily Cashbook, Parameters pie charts, filtered reports and
  shared editable WhatsApp drafts. Messages are never sent automatically.
- Reception sees Admissions, Renewed Members, Renewals, PT, Enquiries, Follow-ups,
  Attendance, Review Members, Members, Pending Amounts and Expenses. Reception
  cannot export reports, edit shared messages or access Daily Cashbook.
- Attendance imports, daily absentees, seven-completed-day absence follow-up and
  click-to-call links. Device read coverage is checked before absence is inferred.
- Supabase assigns member/device IDs; reserved Team Zenith IDs stay protected.
- Dashboard sessions persist encrypted across local server restarts until logout.
  Optional login-free operational pages are limited to the gym's local network.

## Validation

```powershell
npm test
python -m unittest discover -s scripts -p "test_*.py"
npm audit --omit=dev
```

Application tests use mocked external services and do not change live members or
hardware. Import integrity tests require private exports under `migration-data/`,
which are intentionally excluded from Git. SQL smoke tests in `supabase/tests/`
run separately in the Supabase SQL Editor and roll their fixtures back.

See [release verification](docs/release-verification.md),
[reception access](docs/reception-dashboard.md),
[staff account setup](docs/staff-accounts.md),
[local sessions and operations](docs/local-operations.md),
[attendance](docs/attendance.md), and [WhatsApp templates](docs/whatsapp-messages.md).

## Hosting status

This source release runs as a **local Node server**. It is not yet a Vercel
serverless deployment. The current encrypted session files and background worker
require persistent local storage and a running process. The gym's private-IP
fingerprint device must remain behind a local bridge. Do not deploy the root
HTML files alone: their `/api/portal` routes need the backend.

[Vercel readiness](docs/vercel-readiness.md) lists the remaining hosting work.
No production cloud deployment is performed by this release.
