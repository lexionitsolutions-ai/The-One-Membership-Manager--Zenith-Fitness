# Release verification - 28 October 2026

## Completed

- 61 Node application tests passed after the final message changes: auth,
  role restrictions, persistent sessions, staff creation/role repair, form retries,
  split payments, member updates, PT, lead/review follow-ups, WhatsApp templates,
  membership parameters, reception export denial, attendance/absentees, secondary
  delivery, protected device IDs and UI template rendering.
- 10 Python import/date/accounting integrity tests passed using the private local
  snapshots. Those snapshots are not included in this repository.
- Compatible production dependency updates applied with install scripts disabled.
  npm audit then reported zero vulnerabilities.
- Four Supabase WhatsApp templates were backed up privately, updated via the
  version-checked admin API and read back to verify exact canonical wording.
  Admission, renewed membership, enquiry and renewal reminder retain dynamic
  member fields. The repeated enquiry heading is retained as supplied. Damaged
  pasted emoji glyphs use valid Unicode. Dates render as DD-MM-YYYY across forms,
  dashboard drafts and fallback cells. No WhatsApp messages were sent.
- Live local API checks confirmed Supabase reports, parameter filters, machine
  operations, member lookup and fingerprint attendance import. Device logs were
  read without altering fingerprints/users/access settings during release QA.
- Credentials, runtime sessions, logs, migration exports and backup folders are
  excluded from the release and Git.

## Limits

- Native browser visual QA was stopped by Computer Use because it could not
  determine the current browser URL confidently. Responsive layouts were checked
  through rendering tests and source/API checks, not a completed browser viewport
  walkthrough in this release.
- SQL smoke files were not re-executed remotely: the available secret key is an
  Auth/Data API credential, not a postgres SQL connection. Their transaction and
  RLS checks must run separately in the SQL Editor.
- Live QA did not create real admissions, renewals, payments or PT contracts;
  these mutations were validated with isolated test fixtures/mocked services.
- This is not yet a production Vercel deployment; see vercel-readiness.md.
