# Zenith Reception

The receptionist dashboard contains these pages: Admissions, Renewed Members, Renewals, Personal Training,
Enquiries, Follow-ups, Attendance, Review Members, Members, Pending Amounts and Expenses.
Admissions is the home page. Daily Cashbook and Monthly Sales are absent; payment
registers, monthly sales arrays, collection totals and revenue chart values are
also removed from receptionist dashboard responses. Per-member prices and
outstanding balances remain available for admissions, renewals and collecting
dues. This is an application reporting restriction; underlying operational
Supabase staff policies still support those member-level payment workflows.

Reception can view and add gym expenses after migration 012. Only admins can
void/edit expenses. Expense creation is attributed to the signed-in staff member.

Admins can create staff directly from Staff ? Add staff after completing the
one-time setup in [staff-accounts.md](staff-accounts.md). Enter a name, contact
number or email, password and role; no Supabase UID is needed. Reception's contact
login is **7875692761** when created with that contact number.

For an Auth account already created manually, the alternate setup
`supabase/setup/create_zenith_reception_staff.sql` links
`7875692761@staff.zenith.local` to the gym as **Zenith Reception**. It does not
create accounts or change passwords.

Run `202610280012_reception_expenses.sql`, then
`supabase/tests/reception_expenses_smoke.sql` to verify expense access. The smoke
test rolls back its temporary staff/gym/expenses. Preview the UI without changing
data at `http://localhost:3001/dashboard/?preview=receptionist`.

## Contact number login

Admin **8999699811** maps to the existing admin email configured server-side in
`SUPABASE_ADMIN_LOGIN_EMAIL` in `.env`. Reception **7875692761** maps to
`7875692761@staff.zenith.local`. Both use their existing Supabase account password;
email login also continues to work. Country prefix +91 and spaces are accepted.
Restart the server after changing the email mapping. No password is stored locally.

Reception can view Personal Training contracts, add PT packages, choose trainers,
collect PT dues and open prefilled PT WhatsApp messages. PT access uses the existing
Supabase policies and member-command permissions; no additional SQL is needed.

Reception report exports are disabled throughout the application: the export
button is hidden and both CSV-export functions reject receptionist execution.
Parameters is an admin-only sidebar page. It offers member status (All, Active,
Non-active) and All time, Today, This month, This year or Custom period. Status
is checked at the period end. For date periods, gender and area member charts
count admissions in the period; renewal charts count confirmed renewal
transactions in the period for the selected status. Missing gender/address
values are kept as Not recorded. All time removes the lower date bound.
