# Seven-day attendance and absentee follow-up

Admin and receptionist dashboards both show Attendance with three views:
recorded punches, daily absentees, and members absent seven consecutive days.
Search by name, ID or phone; choose a date, export the filtered full list, or tap
Call to open the member's number in the phone dialer. Lists initially show 100
records, with Show more for the remaining records.

The absentee window is the seven **completed** India calendar days ending
yesterday. Today's punches are also visible in recorded attendance, but today is
not counted as a full absent day. A member must have a confirmed membership
covering each day to appear on that day's absent list. A consecutive absentee
must be eligible on all seven days with no biometric punch on any day. Recently
joined, expired, archived, PT-only, Team Zenith and unmapped members are excluded
where appropriate; new joiners can still appear in individual eligible days.

Refresh from fingerprint device reads the device log without clearing it or
changing users, fingerprints or access rules. Recent records are upserted to
Supabase with stable source keys, preserving raw unknown device IDs. SDK local
clock fields are interpreted in Asia/Kolkata. Repeating an import is safe.
Raw punches do not prove the door granted access, so imported access_result is
unknown. Absence means no recorded punch, not a confirmed lack of physical entry.

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
