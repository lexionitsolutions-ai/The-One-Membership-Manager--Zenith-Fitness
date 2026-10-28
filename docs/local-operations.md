# Sessions and direct form access

Dashboard sign-in has no fixed application expiry. The HttpOnly cookie is renewed
while the app is used, and the Supabase refresh token survives local server
restarts in an encrypted session store. Logout removes the saved session and
revokes that Supabase session. Disabled staff and sessions revoked by Supabase
still lose access. A temporary connection failure does not erase a saved session.
Browser cookie deletion or browser-imposed storage limits can require sign-in again.

The root `.env` enables direct operational pages with:

```dotenv
OPEN_OPERATIONS_ENABLED=1
OPEN_OPERATIONS_GYM_ID=b80cd818-2abe-4a90-9027-e2ba1916aec4
```

Admission, renewal, enquiry, member update, personal training and dated fingerprint
sync are available without staff sign-in from localhost and private LAN addresses.
Dashboard reports, staff management, expenses and follow-up management still
require a staff login. The direct links are available on the dashboard sign-in page.
The preview button is removed.

On first use the server creates **Zenith Local Operations**, a dedicated machine
account with a randomly generated password. Migration 013 provisions its gym
assignment atomically. This account supports the existing validated Supabase RPCs
and device-sync permissions without loosening database access for anonymous keys.
No human password is used or changed. Its tokens and generated credential stay on
the server, encrypted under `runtime-private/`; this directory is excluded from git
and is never served by Express. Preserve its key and encrypted files together.
Do not remove this staff entry while using direct operations. Disable the entry
to revoke direct operations, or set `OPEN_OPERATIONS_ENABLED=0` and restart.

Unsigned form changes and device sync are attributed to **Zenith Local Operations**.
Signed-in admin/reception form changes retain their own staff attribution. A signed-in
dashboard logout does not disable these separately authorized direct operations.
The server continues secondary Sheets delivery through this account even if no
dashboard session is active. Device sync still requires the explicit dated sync
action when automatic fingerprint syncing is disabled.

This is intended for the gym's local server and LAN. Public-IP requests do not
receive direct operational access. Cross-site mutations are rejected by the same
origin checks, and cross-site operational reads are rejected too.
