# PT grouping and Review Members

Run migration `202610280011_member_reviews.sql` after 010, then run
`supabase/tests/member_reviews_smoke.sql`. The test uses a temporary gym and rolls
everything back; it does not touch Google Sheets or fingerprint hardware.

IDs beginning with PT (case-insensitive, ignoring surrounding whitespace) are
classified as personal training. Their existing membership periods appear in
Personal Training instead of gym Admissions, Renewals and Renewed. Their original
IDs, member records, device mappings, payments, refunds and opening balances stay
intact. Legacy PT dues use the original membership ledger; new PT contracts use
the PT ledger. Missing legacy trainers or accounting data are shown as unknown /
Needs review rather than guessed. Historical financial collections remain in the
overall payment totals. The general member directory and fallback archive keep
the original records; this change does not alter fingerprint access eligibility.

**Review Members** is available to admins and receptionists. It defaults to the
previous calendar month (for example, September while viewing October). Select
All months or another expiry month to reach older members. Filters include open
follow-ups, today, overdue, interested, not interested, returned/renewed and all
expired members, plus reason and name/ID/phone search.

The exact-date picker can match a follow-up date, membership expiry date or
expected return date. An exact date searches across expiry months. Choosing a
specific expiry month clears the exact date; Clear date removes the exact-date
filter. These filters also apply to the exported review list.

Open follow-ups contain only the latest confirmed expired gym period per member.
Archived members, PT IDs, Team Zenith IDs and anyone with a later confirmed
membership are excluded. Call links open the phone dialer; WhatsApp opens a draft
using the centrally editable **Expired member follow-up** message.

Use Update follow-up to record contact type, status, non-renewal reason, other
reason text, expected return date, next follow-up date and remarks. Interested
requires a return date; Call Later requires a next follow-up date. Every update
keeps an immutable history entry. Retry IDs prevent duplicate history; stale
updates are rejected instead of overwriting newer conversations.

Record renewal opens the existing Supabase renewal form with the member selected.
Once a genuine confirmed renewal extends that period, the open review disappears
and its saved follow-up cycle appears under Came Back & Renewed. The status alone
cannot invent a renewal or payment. If a later period expires again, it starts a
fresh follow-up cycle while previous history remains available.

Review notes are stored in Supabase; the existing six fallback tabs are unchanged.

## Review filters, scheduled calls and contact timeline

Review Members keeps Expiry month, Match date and Select date visible. Search,
Follow-ups, Reason, Clear date and Reset parameters are inside the Parameters
expander. Exact dates work across expiry months; selecting an expiry month clears
an exact date. The Parameters expander retains its open state while filtering.

Not Interested members remain visible in the default open-review selection with
red cards. A member with a rejoin date has a green card unless Not Interested is
the current status, which takes precedence. Renewed memberships still close the
old review cycle through the existing renewal rules.

An unrenewed review with a next follow-up date appears in the Follow-ups calls
list alongside enquiries. Yesterday, Today, Tomorrow, Overdue and exact-date
filters all use that date. The call card edits the original member review and
shows its history; it never creates a duplicate enquiry. Once renewed, the old
review leaves the calls list. Explicitly scheduled Not Interested reviews also
appear on the date staff selected.

Below the status badge, each card shows its saved update count, recorded contact
count, the last four timeline entries and intervals between updates. History
opens all entries. Counts cover the current membership review cycle. Contact
entries are saved Call, WhatsApp or Visit updates with a non-Pending status;
clicking a phone link alone does not record a completed contact.

Admin and receptionist dashboards read the complete gym-scoped review history,
independently of the overview report date range. Only display fields are attached
to member cards; RPC results and request hashes are excluded. Trainers cannot
read this history. The existing review and history tables are used; no migration
is needed. Saving retains the existing request-ID retry and concurrency checks.

## CNR and the shared follow-up / rejoin date (017)

Apply `supabase/migrations/202611040017_review_cnr_shared_date.sql` once in the
Supabase SQL editor. The database currently restricts review statuses, so this
migration is required to save **Call Not Received (CNR)**. Then run
`supabase/tests/review_cnr_shared_date_smoke.sql` to verify the transactional
workflow with temporary records; that script rolls its test data back.

The edit form removes Contact type and the separate Interested to join again
input. One **Next follow-up / Rejoin date** is used by the form, cards, history,
filters and enquiry Follow-ups calls. The same date is stored in both existing
columns for compatibility. When an older record has conflicting dates, the next
follow-up date takes precedence; the old database values and history are not
rewritten by this migration. An older rejoin-only date is still scheduled.
Interested and Call Later require the shared date. CNR can be saved without a
retry date; selecting one schedules another call.

Scheduled review calls carry the **Old Gym Member** heading. They use the original
review actions and history instead of adding duplicate enquiry records. Contact
type is inferred during saves (WhatsApp Sent -> WhatsApp, Pending -> Other,
otherwise Call). CNR updates count as unanswered calls, separately from recorded
contacts, and still appear in the status timeline. Existing retry IDs, stale-save
protection, renewal validation and role restrictions remain in place.

## Missing member_reviews table while applying 017

Error `42P01: relation public.member_reviews does not exist` means migration 011
has not created the review tables in the selected project (or SQL Editor is in a
different project). Check the project against the app's `SUPABASE_URL` first.
Run the entire `supabase/setup/repair_member_reviews.sql` as postgres in SQL Editor.
It checks the base tables, staff-role helper and configured Zenith gym, creates
missing review tables and their role-based read policies, then installs the
canonical 017 CNR/shared-date RPC in one transaction. It can be rerun without
removing existing records. It also requests a PostgREST schema-cache reload.
There is no need to rerun 017 separately after this repair.
