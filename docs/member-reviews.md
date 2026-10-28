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
