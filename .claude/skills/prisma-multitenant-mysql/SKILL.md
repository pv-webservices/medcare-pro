---
name: prisma-multitenant-mysql
description: Conventions for Prisma schema design, migrations, and connection handling for MEDCARE PRO's one-database-per-clinic model on Hostinger MySQL. Use whenever touching prisma/schema.prisma, writing a migration, or wiring lib/prisma.ts.
---

# Prisma + Multi-Tenant MySQL Conventions

MEDCARE PRO uses **one isolated MySQL database per clinic** — not a shared
database with a `clinic_id` column. This is a deliberate architecture
decision from the PRD, not an oversight.

## Hard rule

- **Never add a `clinic_id` (or similar tenant-discriminator) field to any
  model.** If you find yourself wanting one, stop — it means you're solving
  isolation the wrong way for this project. Isolation here comes from each
  clinic having its own database and its own `DATABASE_URL`, full stop.

## Schema conventions

- Table names in the database stay `snake_case` and match the PRD exactly
  (`patients`, `appointments`, `clinic_settings`, `ivr_logs`) — use `@@map()`
  if the Prisma model name is PascalCase.
- Column names map the same way: Prisma fields can be camelCase, but use
  `@map("snake_case_name")` so the underlying columns match the PRD's
  Section 7 field names exactly.
- `amount_paid` must use Prisma's `Decimal` type, never `Float` — floats
  introduce rounding errors that compound in the dashboard's revenue totals.
- `ivr_logs.status` and any other status-like field should be a Prisma
  `enum`, not a free-text string — prevents typos like `"Pending"` vs
  `"pending"` from silently breaking dashboard filters.
- Every foreign key relation (e.g. `Appointment.patientId → Patient.id`)
  needs an explicit `onDelete` behavior — decide and document whether
  deleting a patient cascades to their appointments or is restricted; don't
  leave it on Prisma's default.

## Migrations

- Since this schema gets deployed fresh to a new database for every new
  clinic, always generate migrations with `prisma migrate dev` locally and
  ship them with `prisma migrate deploy` — never hand-write one-off SQL
  against a clinic's database directly. A migration that isn't in the
  migration history can't be replayed for clinic #11.
- Treat `prisma/migrations/` as part of the template repo that gets cloned
  per clinic — it must run cleanly against an empty database every time.

## Connection handling

- `lib/prisma.ts` must use the singleton pattern (cache the client on
  `globalThis` in development) to avoid exhausting Hostinger MySQL's
  connection limit during Next.js hot-reload.
- Each clinic's deployment gets its own `DATABASE_URL` in its own `.env` —
  never a shared connection string with a database-name suffix trick.