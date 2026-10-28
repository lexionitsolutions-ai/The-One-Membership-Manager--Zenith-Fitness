# Vercel deployment

Production workspace: https://the-one-membership-manager-zenith-f.vercel.app

## Cloud setup

- Node.js 24, repository root directory, `vercel.json` included.
- Apply `supabase/migrations/202610280016_cloud_runtime.sql` as postgres.
- Configure private Vercel production and preview environment variables:
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `SUPABASE_ADMIN_LOGIN_EMAIL`, `PORTAL_SESSION_SECRET`,
  `OPEN_OPERATIONS_GYM_ID`, `OPEN_OPERATIONS_ENABLED=1`,
  `FALLBACK_SPREADSHEET_ID`, `SUPABASE_DEVICE_SYNC_ENABLED=0`.
- Keep PORTAL_SESSION_SECRET stable, random and at least 32 characters. Never
  publish it: it encrypts cloud sessions and signs private forms access links.
- Credentials belong in Vercel environment settings, never in Git or browser code.

## Staff sign-in and form access

Dashboard staff use their existing Supabase credentials and roles. Cloud login
sessions persist in encrypted Supabase records across function instances and
redeployments. Refresh is serialized with a database lease. Logout deletes the
session record, revokes its Supabase session and clears the browser cookies.

New Admission, Renewal, Enquiry and Personal Training are public forms: no
individual login or private staff link is required to fill and submit them.
Their operational APIs are narrowly scoped; public PT lookup does not expose
membership balances, and public callers cannot edit member profiles, collect
existing dues, export reports or access dashboard data.

Administrators can open **Activity & sync ? Private staff link for forms** and
copy the link to trusted staff devices. Opening it once grants an HttpOnly forms
access cookie. It unlocks Member Update and device sync without granting a
dashboard session or report access. The four public forms do not need this link. The link is a shared staff credential; keep it private. Rotating
PORTAL_SESSION_SECRET invalidates links and requires clearing/recreating the
old cloud session records under the former encryption key.

## Keep the gym computer running

Run the local app with its existing `.env`, Google service-account file and
fingerprint device connection. Its local operations account publishes a heartbeat
and claims scoped bridge jobs. The computer and device must stay powered on and
connected to the gym LAN. No router port forwarding is needed.

Vercel sends dated fingerprint sync, fallback delivery and attendance-read
requests through the protected Supabase queue. Requests are deduplicated while
active, expire if not handled, and are checked again against staff access before
execution. The browser reports success only after the gym bridge confirms it.

Forms and dashboard database operations continue when the gym PC is off. Device
refresh and fallback delivery require the local bridge; the cloud UI reports
when it is offline. Automatic fingerprint sync stays disabled unless explicitly
configured on the gym computer. Private links do not bypass this setting for
background sync; explicit dated sync remains available.

## Verification

Run `npm test`. Cloud tests cover encrypted cross-instance storage, concurrent
refresh, private access token tampering, job scoping/offline handling and polling.
Live verification also checked HTTPS login cookies, the authenticated dashboard,
private forms without dashboard access and an attendance-read job through the
local bridge. No membership/payment/device-access writes are used by these checks.
