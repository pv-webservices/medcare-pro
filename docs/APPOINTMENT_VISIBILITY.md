# Appointment visibility and Doctor portal linkage

MEDCARE PRO keeps one permission-driven dashboard and one appointment data
model. Doctor-facing views are not a parallel application; they use the same
appointments, lifecycle, status history, audit logs, reschedule chain, and
dashboard layout hierarchy as every other tenant user.

## Read permissions

- `appointment:read` grants clinic-wide appointment visibility in the clinics
  covered by the granting role assignment. Admin and Receptionist defaults keep
  this permission.
- `appointment:self:read` grants only appointments whose `doctor_id` belongs to
  a Doctor profile explicitly linked to the logged-in User, and only in clinics
  covered by that permission's role assignment.
- If both permissions apply, their valid per-clinic scopes are unioned. This
  supports combinations such as Doctor in Clinic A and Admin in Clinic B.
- A clinic picker, `doctorId`, or appointment ID is always a filter, never an
  authority source. `src/lib/appointmentScope.ts` resolves the server-side
  Prisma scope used by boards, details, indicators, and appointment-backed
  dashboard queries.

## Doctor and User relationship

`Doctor.userId` is optional. Administrators link it explicitly from the existing
Doctor create/edit workflow; names, email similarity, phone numbers, and role
labels are never used to infer identity. The compound unique key
`(clinic_id, user_id)` allows the same user to represent a clinician at several
clinics but prevents duplicate links inside one clinic. Existing Doctor rows are
left unlinked after migration.

The foreign key uses `ON DELETE SET NULL`. Removing a portal login therefore
cannot delete a Doctor profile, appointment history, registrations, schedule
locks, or audit evidence. An unlinked self-only user sees an actionable empty
state and no appointment rows; clinic-wide data is never used as a fallback.

## Appointment wall-clock time

Appointment slots are clinic wall-clock values tagged as UTC. They are not real
UTC instants. `appointmentWallClockNow()` rebuilds the server's local date and
clock with the same tagged representation before slot comparisons. Today's
timeline uses the complete half-open wall-clock day `[00:00, tomorrow 00:00)`;
past and terminal appointments remain visible, and the source query is not
truncated to ten rows.

## Dashboard behavior

The dashboard remains `/dashboard`. Appointment metrics, the waiting/next
patient, full-day timeline, and next-seven-days agenda all use the central read
scope. The seeded Doctor role default is a focused My Day layout, while personal
layouts still take precedence and authorised widgets remain customisable.

The safe role backfill changes only exact, untouched system-role snapshots:

- untouched Doctor: replace `appointment:read` with
  `appointment:self:read` and add a Doctor role layout only when no role default
  exists;
- untouched Admin: add the new permission while retaining broad
  `appointment:read`;
- customised roles and existing role/personal layouts: unchanged.

Run `npm run doctor-self:backfill` first for a dry run. Applying to a remote
database requires the explicit `--apply --allow-remote` flags after review.
