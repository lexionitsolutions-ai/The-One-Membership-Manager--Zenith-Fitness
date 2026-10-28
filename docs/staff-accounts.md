# Create staff from the dashboard

One-time setup:

1. Run `supabase/migrations/202610280013_staff_accounts.sql` in the Supabase SQL Editor as postgres.
2. In Supabase project settings, copy a secret API key. Add it to the root `.env` locally:

   ```dotenv
   SUPABASE_SECRET_KEY=your_secret_key
   ```

   An existing `SUPABASE_SERVICE_ROLE_KEY` is also supported. Never add either key
   to browser code, a NEXT_PUBLIC variable, screenshots or chat.
3. Restart the local server. Sign in as admin, open Staff → Add staff.
4. Enter name, email OR contact number, password (at least 8 characters), and role.

The backend checks the current administrator's active gym assignment before using
the secret key. Supabase Auth creates a confirmed account; an Auth insert trigger
creates its staff assignment in the same database transaction. Any failure rolls
back both. The role and gym come from the authenticated admin request. Public
signup metadata cannot assign staff access because the trigger only reads
server-controlled app metadata, never user metadata.

Contact-only accounts use `<number>@staff.zenith.local` internally and can sign in
with their number. Email accounts sign in with their email. The existing admin
contact alias is retained. Selecting a role controls the existing role-specific
dashboard and permissions. Removing staff still disables gym access, preserving
history. Existing logins are never overwritten or given a new password by Add staff.
If a connection fails, refresh Staff before retrying to check whether it saved.

Passwords go directly from the form through the server to Supabase Auth. They
are not stored in app tables, browser storage, source files or logs. The form
clears its password when closed. Use HTTPS when hosting beyond localhost.

Run `node --test gym-access-system/staffAccounts.test.js` for API checks and
`supabase/tests/staff_accounts_smoke.sql` for rollback-only database checks.

If migration 013 was installed before the metadata-timing fix, apply
`202610280014_staff_provisioning_fix.sql` to provision staff on Auth app-metadata
updates as well as inserts. The server also verifies each newly created account
and supplies a missing gym assignment before reporting success. Existing accounts
and passwords are never changed by this compatibility check.
