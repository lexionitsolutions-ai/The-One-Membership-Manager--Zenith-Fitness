# Shared WhatsApp messages

Run migration `202610270010_whatsapp_templates.sql` in Supabase SQL Editor after
009, then run `supabase/tests/whatsapp_templates_smoke.sql`. The smoke test rolls
back its temporary gym and message edits.

Sign in as admin and open **WhatsApp Messages** in the dashboard sidebar. Choose
a message, edit its text, insert supported placeholders with the buttons, review
the sample preview and save. Save persists to Supabase. Receptionists use the
saved text; only admins can change it. Simultaneous admin edits are checked so a
stale editor cannot silently overwrite a newer message.

The seven templates cover:

- Admission confirmation: full admission form and Admissions list.
- Renewal reminder: Renewals expiry list.
- Renewed confirmation: full renewal form and Renewed list.
- Personal training: PT form confirmation and PT members list.
- Enquiry response: enquiry form confirmation.
- Lead follow-up: enquiry/follow-up WhatsApp actions.
- Pending payment: verified outstanding-membership balances.

The default texts preserve the existing admission, renewal and enquiry form
messages. After activation, manage their wording and any quoted prices here.
Placeholders are filled from the selected member/period; preview values are
samples. The editor accepts only the placeholder names listed for that message.

Dashboard messages refresh with the normal report refresh. Forms refresh the
shared settings before saving and constructing the WhatsApp draft. Saved
admission/renewal wording is also used in fallback-sheet WhatsApp cells, refreshed
through the Sheets queue. No new sheet is created.

These are prefilled drafts, not automatic sends. Opening WhatsApp still requires
a valid phone number; staff review the message and send it in WhatsApp. Editing a
template does not send a message or alter a message already sent.
