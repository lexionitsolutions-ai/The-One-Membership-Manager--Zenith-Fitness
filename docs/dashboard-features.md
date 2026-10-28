# Management dashboard

## Current modules

Overview; monthly sales; admissions; renewals; members; attendance; staff; payments; expenses; enquiries; activity/sync.

Admissions contains only new-admission transactions. Renewals is the monthly latest-expiry follow-up list. Renewed is a separate register of confirmed renewal transactions, including renewals bought in advance; it retains the full history rather than overwriting earlier renewals. Date/package filters and exports are available in the new register. Submission-date filters use India time, with historical start dates as a fallback where no submission timestamp exists.

Admissions, Renewals and Renewed each have a WhatsApp column with a row-specific prefilled welcome, expiry-reminder or renewal-confirmation message. Staff can preview the text, then open WhatsApp to review and send it themselves. Ten-digit numbers default to India's +91 country code; missing/invalid numbers do not get an active link. Cancelled admissions do not show a confirmation link. Filtered CSV exports include the message and link. No messages are automatically sent, and no database migration is needed for these UI additions.

- Larger type (14 px table values, 16 px base text), consistent headings and simpler labels.
- Search and per-page date, plan, status, payment-method, category and role filters.
- CSV export of all matching management rows, including rows beyond the on-screen limit.
- Admissions and renewals save through transactional, permission-checked database functions.
- New payments are limited to the confirmed outstanding amount. Imported unknown payment history remains unknown.
- Staff assignments can be created from an existing Auth User UID, edited, disabled and restored. Removal does not delete the underlying login account or payment history. The last active admin is protected by a database trigger.
- Expense entry and voiding; enquiry creation and follow-up status/date updates.
- Audit records and pending synchronization jobs are written in the same transaction as new memberships/payments.

## Real data and activation

1. Run `supabase/migrations/202610270003_management.sql` once in the project's SQL Editor.
2. Run `supabase/migrations/202610270004_direct_forms.sql` once after 003. Verify with `supabase/tests/direct_forms_smoke.sql`; all its fixtures roll back.
3. Sign into `http://localhost:3001/dashboard/` with the existing admin account.
4. Click **Import real data into Supabase**. The server sends only the prepared private snapshot under the administrator's authenticated session. No secret/service-role key is needed.

Until activation, authenticated admins/receptionists can view the actual spreadsheet snapshot read-only. Trainers see no unassigned spreadsheet members. Sample preview remains explicitly separate and never shows real member data anonymously.

The prepared export contains 652 members, 1,142 usable membership periods, 673 cashbook receipts and 54 held membership rows. The original workbook and full extracted archive remain private backups. Unknown gross/discount amounts remain null; the known historical final charge is stored separately. Only 355 imported periods have reconciled opening payment information. Opening paid amounts are not booked as additional collections. The source export contains no Attendance or Enquiries tabs, nor historical expense records.

Monthly collections use cashbook receipt dates and subsequent recorded payments, net of refunds. Counts of admissions/renewals use membership start dates. Cash balance is collections minus entered expenses, not accounting net profit. Historical records still need reconciliation before financial cutover.

The old Sheets/fingerprint service is unchanged. New Supabase memberships queue jobs but the worker that delivers them to Sheets/the device is still to be connected. The entry form and activity page disclose this. Do not treat a pending job as a successful device update.

## Overview, packages and direct forms

- Overview uses a navy/purple colour scheme and simple cards: daily/weekly/monthly admissions and renewals, cash/online/total collections, and active/non-active/total members.
- Custom date inputs include both boundary dates in Asia/Kolkata. Daily, weekly and monthly update counts are anchored to the selected end date. Weeks begin Monday; months begin on the 1st. Member totals/status are as of that end date. New form counts use the submission timestamp; historical rows without one use the membership start date, disclosed in the overview.
- Package filters cover 1 Month, 3 Months, 6 Months, 1 Year and Customize Packages. Fixed 30/90/180/365-day terms and exact calendar 1/3/6/12-month terms are recognised. Other durations fall under Customize Packages; explicitly custom plans remain custom.
- The default renewal view groups each member by their latest confirmed expiry month, including all dates from the 1st to the month's end. Renewing moves the member to the new expiry month. Renewal history retains all original transactions.
- Existing full forms are served at `/forms/index.html` and `/forms/renewal.html`. They require the signed-in staff session to save or look up members. `script.js` and `renewal.js` post to the authenticated local API, which calls the transactional Supabase RPC using the user's token. They no longer POST to Apps Script, read member details from Sheets, or trigger the old Sheets-based device sync.
- Each form keeps a request UUID across network retries. The database stores a payload fingerprint with that UUID, returns the original result for the same request, and rejects reuse with changed data. Profile, membership, initial payment, audit and secondary-sync jobs commit together.
- Successful full-form submissions notify other dashboard tabs to refresh immediately. A periodic refresh remains enabled. Serving old static deployments requires deploying the updated HTML, form helper and API together; opening the local files via `file://` is not supported for authenticated writes.

## Research used

Official product pages reviewed on 27 October 2026:

- [Glofox features](https://www.glofox.com/features/): membership management, billing, staff, CRM, reporting, access control, bookings.
- [Mindbody reporting](https://www.mindbodyonline.com/business/reporting): sales, membership and business reporting.
- [Mindbody report filters](https://support.mindbodyonline.com/s/article/Analytics-2-0?language=en_US): date, membership and other report dimensions.
- [Virtuagym gym software](https://business.virtuagym.com/gym-software/): memberships, billing, coaching, scheduling and member engagement.

Implemented the operational membership, billing-record, staff, lead, check-in, follow-up, filtering and reporting patterns that fit the available data. Class booking, recurring payment gateways, payroll, workout programming, measurements and member-app features remain separate future modules; they are not presented as working features.

## Verification

`npm run test:dashboard` tests user-token forwarding, unauthenticated/role-denied access, pagination, calculations, role-specific templates, filters and HTML escaping using mock services. `python scripts/test_real_data.py` reconciles prepared identities, source-period accounting and cashbook totals. SQL/RLS/trigger behavior must be verified against the Supabase project using the supplied SQL smoke query. Browser automation was unavailable, so mobile styling has not received a visual browser review.

## Pending amounts, enquiries and the integrated lead manager

Run migration `202610270005_enquiries_leads.sql` once after the management setup, and verify using `supabase/tests/enquiries_leads_smoke.sql`.

The separate Pending Amounts tab is available to admins and receptionists. It lists confirmed unpaid membership periods, charge/paid/pending amounts, filters, and a Record payment action. The Needs review filter shows unknown historical payment information separately, without inventing debt or treating missing amounts as zero. The administrator's reconciliation button uses the inspected Pending Amounts Sheet: it only fills unknown opening balances where admission ID, expiry date and total charge match exactly and there are no subsequent Supabase payment entries. Existing verified opening balances are not overwritten.

The supplied `C:/Users/Raj/gym-lead-manager/` app was used as the workflow reference, without modifying its files or deploying its old Apps Script API. Its Today/Yesterday/Tomorrow/Overdue/All Pending/Trial Done views, admission conversion count, custom date, call/WhatsApp actions, status, next date and remark controls are integrated into the main dashboard's Follow-ups tab. Admins and receptionists can use it; trainers cannot read or update these leads. All leads and Admission Done filters make closed/conversion records inspectable. Marking a lead Admission Done records a lead outcome; it does not create a membership automatically.

Existing lead history was read from the native `Enquries Zenith Fitness` spreadsheet, ID `1yShVobaYO0tOV4Ce82JQ5IA8tYdkitZEGrbyQ_0M2pc`, tab Enquiries, bounded range A1:M997. Raw reads and the prepared 627 named enquiry records remain under private `migration-data/enquiries/`. Date separator rows are excluded. Misspelled legacy statuses are normalized for filtering and preserved in `legacy_status`. One malformed follow-up date is kept in notes and flagged, rather than guessed. Invalid phone information is also flagged and cannot open a call/WhatsApp link. Existing lead import is insert-only and repeat-safe by source row key, so reimport does not overwrite follow-ups saved in Supabase.

The historical Sheet's Email column contains both email and address information. Values that match an email address are stored as email; other values are retained as address. The current full enquiry form now has separate Address and Email inputs, with source, interest, follow-up date and requirements. New entries save directly through `submit_enquiry`, atomically with a retry key and secondary Sheets-sync job. There is no Apps Script fallback. The dashboard modal uses the same RPC. Follow-up updates are transactional and preserve a timestamped history with the staff actor and remark.

Use the Enquiries tab's Import existing enquiry history button after applying migration 005. Use Pending Amounts → Reconcile imported sheet balances to reconcile the inspected nine-row pending snapshot (three previously unknown opening balances can be matched exactly). This is an October 27 export, not an ongoing Sheets read. The underlying Google Sheets were not edited. Queued secondary Sheets/device delivery still requires the separate worker described above.
