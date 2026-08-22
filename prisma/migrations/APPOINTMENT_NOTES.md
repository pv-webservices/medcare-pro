# AP-1 — appointment schema, permissions and feature registration

Schema only. No booking code ships in AP-1: AP-2 computes slots, AP-3 books,
AP-4 reschedules / cancels / checks in, AP-5 converts. The tables, the
permission keys and the catalogue entry land first so the migration is a
one-time event over live data rather than something four later stages each
have to repeat.

Applied against a **local database only**. Not run against production or
Hostinger, not committed, not pushed.

## Migration order

| Step | What |
|---|---|
| **M1 expand** — `20260823090000_appointment_expand` | Creates `appointment_types`, `appointments`, `doctor_schedule_locks` with all their indexes and foreign keys; adds the nullable `registrations.appointment_id` column with no index and no foreign key. |
| **Backfill** — `npm run ap1:backfill -- --apply` | Create-only. Registers the `appointments` feature and links it to the `standard` plan; tops up seeded roles that are demonstrably untouched. |
| **Validate** — `npm run verify:ap1-appointments-schema` | Confirms every existing registration still holds `appointment_id IS NULL`, that no appointment rows were manufactured, and that pre-existing row counts are unchanged. |
| **M2 constrain** — `20260823090100_appointment_constrain` | Adds the `UNIQUE` index on `registrations.appointment_id`, then the foreign key. |

Everything M1 adds lands on a table it creates empty, where a unique index
cannot fail on existing data — the same reasoning `STAGE1_NOTES.md` records.
`registrations` is the one table in AP-1 that already holds rows, so it is the
one place where a constraint is worth proving before applying, and the only
thing M2 carries.

The unique index and the foreign key are kept **together** in M2 rather than
split. Adding the foreign key in M1 would have made MySQL auto-create its own
plain index on the column to satisfy InnoDB, which the `UNIQUE` index would then
duplicate — leaving a redundant index behind permanently. This order lets the
`UNIQUE` index serve the foreign key, so there is exactly one. The verify script
asserts that.

## The three rules every later stage inherits

1. **No appointment row is ever deleted.** Cancel, no-show, reschedule and
   conversion are all status transitions. The audit trail and any future
   utilisation reporting depend on the retired rows still being there.
2. **`slot_start` / `slot_end` are never updated after insert.** Rescheduling
   creates a new row pointing back at the old one via `rescheduled_from_id`; it
   does not move the old one. That is what keeps the history honest and what
   makes `active_slot_start` a pure function of `status`.
3. **Occupancy is derived from status, in exactly one column.**

```
active_slot_start = slot_start   when status is SCHEDULED | CONFIRMED | CHECKED_IN | CONVERTED
active_slot_start IS NULL        when status is CANCELLED | NO_SHOW | RESCHEDULED
```

`src/lib/appointmentRules.ts` is the single source of that mapping
(`activeSlotStartForStatus`), and the verify script asserts it over real rows.

**CONVERTED occupies the slot.** A converted appointment is a patient who
arrived and was seen, so the time was genuinely consumed. Releasing it would
let a second booking land where a visit demonstrably happened, and would corrupt
any doctor-utilisation figure built on this table. `NO_SHOW` does release, which
means a past slot becomes bookable again — harmless, and occasionally useful for
backfilling a walk-in.

## Concurrency

An application-level "is this slot free?" check **is not concurrency-safe**.
Two requests can both read "free" and both insert. The design below is what
closes that window, and it has two independent mechanisms.

### Primary: `doctor_schedule_locks`

One row per doctor per calendar day, carrying no data and never read for its
contents. Every write that can occupy or release a doctor's time — book,
reschedule, cancel, check in — must run this protocol inside one transaction:

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;   -- see "Two corrections" below
BEGIN;

-- 1. Ensure the lock row exists AND take an exclusive lock on it, in one
--    statement. MUST be ON DUPLICATE KEY UPDATE, never INSERT IGNORE.
INSERT INTO doctor_schedule_locks (id, doctor_id, date, created_at, updated_at)
VALUES (?, ?, ?, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE updated_at = updated_at;

-- 2. Hold it explicitly. THE SERIALISATION POINT. A competing transaction
--    blocks here until this one commits or rolls back.
SELECT id FROM doctor_schedule_locks
 WHERE doctor_id = ? AND date = ? FOR UPDATE;

-- 3. The overlap check, AS A LOCKING READ. Half-open [start, end).
SELECT id FROM appointments
 WHERE doctor_id = ?
   AND status IN ('SCHEDULED','CONFIRMED','CHECKED_IN','CONVERTED')
   AND slot_start < :requestedEnd
   AND slot_end   > :requestedStart
 FOR UPDATE;

-- 4. Any row -> ROLLBACK, ConflictError. Otherwise insert/update.
COMMIT;
```

### Two corrections the verify script forced

Both were found by racing real transactions, not by reasoning about the design.
The version approved in the AP-1 report deadlocked on both counts. **AP-3 must
implement the corrected protocol above, not the original.**

**1. `INSERT IGNORE` → `INSERT ... ON DUPLICATE KEY UPDATE`.**
`INSERT IGNORE` takes a **shared** lock on the conflicting index record. Two
concurrent bookings for the same doctor-day therefore both acquire an S lock,
and both then try to upgrade to the X lock step 2 needs — a textbook
lock-upgrade deadlock (MySQL error 1213). Neither booking succeeded, and the
loser was not even a clean conflict the caller could report.
`ON DUPLICATE KEY UPDATE` takes an **exclusive** lock instead, so the second
transaction blocks and waits. `updated_at = updated_at` is a deliberate no-op:
the row's contents are irrelevant, only the lock matters.

**2. REPEATABLE READ → READ COMMITTED for this transaction.**
Under MySQL's default REPEATABLE READ, the `FOR UPDATE` overlap read in step 3
takes **gap locks** over the index range it scans — including when it matches
nothing, which is the common case for a free slot. Two bookings for **different
doctors** at the same time of day scan adjacent gaps in
`appointments_doctor_id_slot_start_idx`, and each one's insert-intention lock
conflicts with the other's gap lock. Two completely unrelated doctors deadlocked
each other, which in production would look like random booking failures under
load.

READ COMMITTED takes no gap locks — only record locks on rows that actually
match. Correctness is unaffected because it never came from gap locking: the
`doctor_schedule_locks` row is what serialises writers for a doctor-day, and it
still does. It also removes the stale-snapshot hazard entirely, since every
statement sees the latest committed data. Step 3 stays `FOR UPDATE` regardless,
so the guarantee does not rest on the isolation level alone.

In Prisma: `prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })`.

**Still retry on error 1213 in AP-3/AP-4.** A reschedule takes two lock rows,
and the ascending-`(doctorId, date)` ordering rule makes a deadlock between two
reschedules impossible only if every path obeys it. A bounded retry is cheap
insurance against a path that does not.

**Step 3 must be `FOR UPDATE`.** MySQL's default REPEATABLE READ pins a plain
`SELECT` to a snapshot taken at the transaction's first consistent read, so an
ordinary read here could miss a competitor that committed after that snapshot
but before the lock was taken. A locking read always reads the latest committed
version. For the same reason, **do every scope and validation read before the
transaction opens** — clinic-in-tenant, doctor-in-clinic, type resolution,
patient ownership.

**Lock ordering: ascending `(doctorId, date)`.** Booking touches one doctor-day
and cannot deadlock. A reschedule may touch two — the slot being vacated and the
one being taken, possibly under different doctors — and would deadlock against
its own mirror image without a deterministic order.
`orderLockKeys()` in `appointmentRules.ts` produces the order.

An appointment cannot span two calendar dates (`appointmentIntervalProblem`
refuses it), which is what makes `(doctor_id, date)` a complete key: two
conflicting appointments necessarily share a date and therefore the same lock
row. `doctor_availability.end_time` tops out at `23:59`, so nothing is lost.

Lock rows are created on demand and never cleaned up. One row per doctor per
booked day is negligible, and deleting them would reintroduce the race.

### Backstop: `UNIQUE (doctor_id, active_slot_start)`

MySQL has no partial unique index. The nullable sentinel is the workaround:
MySQL treats NULLs as distinct, so the index constrains only live rows while any
number of retired ones may share a doctor and a start time. The same
NULL-distinct behaviour `roles(tenant_id, key)` already relies on deliberately.

**It is a backstop, not the concurrency control.** It catches exact duplicate
start times only. A 30-minute slot at 09:00 and a 15-minute one at 09:15 overlap
but have different starts, and this index cannot see that. Its value is that if
a future code path ever forgets the protocol, a silent double-booking becomes a
loud constraint violation instead.

### Why not a slot-unit table

A `UNIQUE (doctor_id, slot_start)` over one row per grid unit only works if
every bookable slot lands on a shared canonical grid. This schema cannot
guarantee that: `doctor_availability.start_time` is a free `"HH:mm"` string
(`09:07` is valid input today), and AP-2 requires variable `duration_minutes`
per type. Availability `09:07–10:00` with a 20-minute type yields boundaries at
`09:07 / 09:27 / 09:47`, reachable only with a 1-minute grid — twenty rows per
appointment. Constraining availability entry to a grid would be a behaviour
change to an existing module that AP-1 does not authorise.

### What the verify script proves

`npm run verify:ap1-appointments-schema` opens genuinely concurrent
transactions on separate connections and races them, rather than asserting the
design is sound:

- identical slots → exactly one wins;
- **partially overlapping slots with different start times → exactly one wins**
  (the case the unique index cannot see, so it proves the lock does real work);
- adjacent slots → both win (half-open `[start, end)`);
- different doctors, same time → both win (no false serialisation);
- cancel then rebook → succeeds, and the cancelled row survives with its
  original times intact;
- the unique index alone, with the lock bypassed → still rejects a duplicate
  active start;
- a `CONVERTED` appointment still blocks its slot.

## Registration link — one foreign key, not two

`Registration.appointmentId`, nullable, with `@@unique`. There is deliberately
**no** `Appointment.convertedRegistrationId`. Two columns describing one fact
would form a circular foreign key between the two tables, could drift apart with
nothing able to detect it, and neither column alone could carry the `UNIQUE`
that stops a double conversion. Ask the question from the other side instead —
`appointment.registration` — which Prisma answers through the same column.

The `UNIQUE` is the database-level double-conversion guard: AP-5's second
attempt hits the index rather than racing past an application check.

Every pre-existing registration holds `NULL`, and MySQL permits unlimited NULLs
under a `UNIQUE`. AP-1 populates nothing and does not change how registrations
are created.

## Feature tier — PREMIUM, and what it costs you

`appointments` ships `tier: PREMIUM` while every other module is `CORE`. The
tier decides what an **absent** `RoleFeatureAccess` row means: CORE inherits
(silence allows), PREMIUM does not (silence denies).

CORE is right for the seven existing modules because clinics already depend on
them — making them PREMIUM would lock every existing role out on enforcement
day. Nobody depends on appointments, so there is nothing to break, and PREMIUM
is what lets a Clinic Admin decide which roles get it.

**Expect this, and do not mistake it for a bug:** after AP-1 through AP-9 ship,
nobody sees Appointments until an admin enables it per role under
Settings → Features. Owner is the exception, since layer 3 cannot touch a
wildcard holder. AP-1 writes **zero** `RoleFeatureAccess` rows on purpose.

This required narrowing one existing assertion in
`tests/unit/moduleFeatures.test.ts` from "every module in `MODULE_FEATURES` is
CORE" to "every module a tenant **already relied on** is CORE", plus an explicit
assertion that appointments is PREMIUM. The rule was right; its scope was too
wide. Gating itself was not weakened — a separate assertion still requires every
module in the map, appointments included, to resolve to a real catalogue entry.

## Permission catalogue safety

Eight keys, all marked `pending: "stage"` until their call sites exist:
`appointment:read`, `:create`, `:update`, `:reschedule`, `:cancel`, `:checkin`,
`:convert`, `:type:manage`.

`STAGE_1_PERMISSIONS` and `PRE_STAGE_11_PERMISSIONS` are derived by subtraction
from `ALL_PERMISSIONS`, so **`STAGE_AP1_PERMISSIONS` had to be subtracted from
both**:

- from `STAGE_1_PERMISSIONS`, or `backfill-stage1.mts` would start handing out
  appointment permissions under Stage 1's name;
- from `PRE_STAGE_11_PERMISSIONS`, and this one is easy to miss.
  `isUntouchedPreStage11AdminSet` compares by **exact set equality**, and a
  genuine pre-Stage-11 Admin holds no appointment keys either. Leaving them in
  means that comparison never matches again, so `backfill-stage11.mts` silently
  stops handing out `audit:read` to the organisations still owed it — reporting
  them as "customised" instead. Nothing fails; it just quietly does nothing.

`HISTORICAL_ALL_PERMISSIONS` and `STAGE_11_PERMISSIONS` are unchanged.

Two existing assertions in `tests/unit/auditDescriptions.test.ts` failed the
moment the eight keys entered the catalogue, which is the guardrail working:
one requires every catalogue key to belong to exactly one stage list, the other
pins the size of the pre-Stage-11 snapshot. Both were widened to know about the
third stage list. Every future stage joins them too.

## Default roles

| Role | AP-1 grants |
|---|---|
| Owner | nothing spelled out — holds `*` |
| Admin (`CLINIC_ADMIN`) | all eight |
| Receptionist | the seven booking keys, **not** `appointment:type:manage` |
| Doctor | `appointment:read` only |
| Staff | nothing — array unchanged byte-for-byte |

Taking bookings is not the same as setting the price list, which is why
Receptionist is withheld `appointment:type:manage`.

For **existing** tenants, `scripts/backfill-ap1-appointments.mts` tops up a
seeded role only when its stored permission set equals its frozen pre-AP-1
snapshot exactly (`PRE_APPOINTMENTS_ROLE_PERMISSIONS` in `defaultRoles.ts`) and
`isSystem` is true. One key added or removed by the organisation and the role is
skipped and left byte-for-byte alone.

AP-1 extends the "untouched?" rule to Receptionist and Doctor, which earlier
backfills only ever applied to Admin — those two gain permissions here, so they
need the same proof.

Run the backfills **in order**: `stage1:backfill`, `stage11:backfill`, then
`ap1:backfill`. A role still on an earlier catalogue is skipped and reported,
because appending appointment keys to it would leave it in a state no seed ever
produced.

## Known limitation, deferred to AP-6/AP-7

`@@unique([tenantId, clinicId, name])` on `appointment_types` does **not**
prevent two tenant-wide types (`clinic_id IS NULL`) sharing a name, because
MySQL treats NULLs as distinct. Same quirk `user_roles` documents. The duplicate
check has to be done in application code before insert, the way `lib/roles.ts`
already does it for roles. The verify script asserts the quirk directly rather
than assuming it, since AP-6 has to write that check on the strength of it.

## Pre-existing drift, NOT introduced by AP-1

`prisma migrate diff` reports one statement unrelated to this work:

```sql
ALTER TABLE `clinics` MODIFY `logo_url` LONGTEXT NULL;
```

`Clinic.logoUrl` carries `@db.LongText` in the committed schema, but no
migration in the history ever applies it — confirmed by diffing the migration
history against `git show HEAD:prisma/schema.prisma`, i.e. it is present on
`main` before AP-1 touched anything. It is **deliberately excluded** from both
AP-1 migrations: correcting it would change an existing table outside this
stage's scope. It needs its own migration.
