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

`Doctor.userId` is optional. Authorised Doctor editors link it explicitly from
the existing Doctor create/edit workflow; names, email similarity, phone
numbers, and role labels are never used to infer identity. The compound unique
key `(clinic_id, user_id)` allows the same user to represent a clinician at
several clinics but prevents duplicate links inside one clinic. Existing Doctor
rows are left unlinked after migration.

The foreign key uses `ON DELETE SET NULL`. Removing a portal login therefore
cannot delete a Doctor profile, appointment history, registrations, schedule
locks, or audit evidence. An unlinked self-only user sees an actionable empty
state and no appointment rows; clinic-wide data is never used as a fallback.

Portal linkage is a separate security-sensitive operation from creating a
Doctor profile. `doctor:create` permits an unlinked profile only. Establishing,
changing, or removing `Doctor.userId` requires `doctor:edit` in that exact
clinic. Candidate portal users are likewise returned only for `doctor:edit`
clinics. Linking identity never grants a role or permission.

## Appointment wall-clock time

Appointment slots are clinic wall-clock values tagged as UTC. They are not real
UTC instants. `appointmentWallClockNow()` rebuilds the server's local date and
clock with the same tagged representation before slot comparisons. Today's
timeline uses the complete half-open wall-clock day `[00:00, tomorrow 00:00)`;
past and terminal appointments remain visible, and the source query is not
truncated to ten rows.

Production must set `TZ=Asia/Kolkata` (or the deployment's intentionally chosen
single clinic/server timezone). `appointmentWallClockNow()` uses server-local
calendar and clock getters, so an unset or incorrect host timezone changes the
meaning of "today" and "upcoming". This requirement is also present in
`.env.example`; it contains no secret.

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

## Production rollout order

1. Deploy the schema and application code, applying migration
   `20260910180000_doctor_portal_user_link`. Existing Doctor links remain NULL
   and existing broad Doctor permissions continue temporarily.
2. Before narrowing role permissions, explicitly link every confirmed Doctor
   portal account to the correct Doctor profile and clinic. Multi-clinic
   clinicians need one intended profile/link per clinic.
3. Run `npm run doctor-self:backfill` and review every `WOULD`, `SKIP`, and
   already-current result. Dry-run performs no writes.
4. Stop if the output is unexpected. Customised roles must remain unchanged.
5. After mappings and review are complete, run
   `npm run doctor-self:backfill -- --apply --allow-remote`.
6. Smoke-test signed-in Doctor, Admin, Receptionist, and Owner users. For two
   Doctors in one clinic, verify reciprocal isolation on dashboard, board, and
   direct appointment URLs; also verify the unlinked empty state.

### Production acceptance checklist

- Doctor A: today's four KPI counts, waiting/next patient, full timeline, and
  next-seven-days agenda contain only Doctor A appointments. Past rows remain
  visible. The board is likewise self-only, and Doctor B's direct appointment
  URL returns the existing safe 404-style response.
- Doctor B: repeat the same checks reciprocally in the shared clinic.
- Admin and Receptionist: clinic-wide rows remain visible and existing booking,
  confirmation, check-in, reschedule, cancellation, and conversion actions
  remain available according to their permissions.
- Owner: wildcard access continues to resolve clinic-wide where appropriate.
- Unlinked self-only Doctor: no appointment rows or metrics are disclosed and
  the actionable profile-link warning is shown.
- Multi-clinic Doctor: All clinics combines only that user's linked profiles;
  selecting one clinic removes every other clinic from the result.

The normal `npm run build` executes `prisma migrate deploy` before `next build`.
Use `npx next build` when only application compilation is intended and the
configured `DATABASE_URL` must not be mutated.
