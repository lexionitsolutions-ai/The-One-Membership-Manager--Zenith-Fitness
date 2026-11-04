# Seven-day attendance and absentee follow-up

Admin and receptionist dashboards both show Attendance with four views:
recorded punches, afternoon attendance, daily absentees, and members absent seven consecutive days.
Search by name, ID or phone; choose a date, export the filtered full list, or tap
Call to open the member's number in the phone dialer. Lists initially show 100
records, with Show more for the remaining records.

The absentee window is the seven **completed** India calendar days ending
yesterday. Today's punches are also visible in recorded attendance, but today is
not counted as a full absent day. A member must have a confirmed membership
covering each day to appear on that day's absent list. A consecutive absentee
must be eligible on all seven days with no biometric punch or saved afternoon check-in on any day. Recently
joined, expired, archived, PT-only, Team Zenith and unmapped members are excluded
where appropriate; new joiners can still appear in individual eligible days.

Refresh from fingerprint device reads the device log without clearing it or
changing users, fingerprints or access rules. Recent records are upserted to
Supabase with stable source keys, preserving raw unknown device IDs. SDK local
clock fields are interpreted in Asia/Kolkata. Repeating an import is safe.
Raw punches do not prove the door granted access, so imported access_result is
unknown. Absence means no recorded fingerprint punch or saved afternoon check-in, not a confirmed lack of physical entry.

Successful dated membership sync also imports attendance after releasing its
device connection. Attendance import and membership sync share a device lock.
An attendance import failure is reported separately from a successful access sync.
Failed imports do not replace the last successful import marker or infer new
absentees. The oldest available device log and last successful read determine
which completed days have coverage; an incomplete initial history is displayed
as unavailable rather than seven days of absences.

The existing attendance and audit_logs tables are used. No additional SQL is
needed. Server-side secret-key access writes attendance and stores a scoped
attendance.imported audit marker; dashboard readers remain role checked.

## Afternoon attendance

The separate Zenith Attendance Portal keeps check-ins as browser drafts. Its
**Save and Send** action verifies the selected admission IDs against the configured
Supabase gym, saves attendance, then opens the existing WhatsApp sharing draft.
Failed saves keep the local list and do not share an unsaved attendance list.
The server credentials remain in the portal Vercel environment.

Afternoon saves use the existing attendance table with
`device_identifier=afternoon-portal` and `source_key=afternoon:YYYY-MM-DD:MEMBER_UUID`.
One atomic upsert ignores duplicate source keys, so retrying or saving again adds
new check-ins without duplicating previously saved members. Local draft removals
do not delete check-ins already saved to Supabase. No SQL migration is required.

The dashboard loads the source identifier and shows afternoon records in their
own tab, including the attendance date and actual save timestamp. Attendance
dates and absentee matching use Asia/Kolkata. Historical entries use noon IST on
the selected date; today's entries use the current instant. Both sources contribute
to a single per-member/per-day presence check, so members attending both sessions
count once in daily presence totals. Afternoon saves never assert fingerprint
history coverage or overwrite fingerprint import status.
