# MEDCARE PRO — Agent Instructions (v2)

This file is read automatically by Claude (and referenced by other agents in this
workspace). Follow it before touching any code.

> **v2 note:** the multi-tenancy model changed. This is now one shared platform,
> one database — an Account can own multiple Clinics. If any earlier docs, code
> comments, or skill files in this repo reference "one database per clinic,"
> they're stale — this file and `/docs/PRD.md` (v2) are current.

## Before doing anything

1. Read `/docs/PRD.md` (v2) in full — product scope, functional requirements,
   data model, and API endpoints.
2. Read `/docs/PROJECT_STRUCTURE.md` (v2) in full — the exact folder/file
   layout to follow.

## What this project is

MEDCARE PRO — a multi-clinic management platform. One account (a business
owner) signs up once and can manage multiple clinics under that login. Each
clinic has its own doctors, patients, and revenue tracking, scoped within the
shared database by `clinicId`. Core features: patient registration with an
edit audit trail, doctors and clinics management, role-based access control,
revenue analytics, notifications, and WhatsApp messaging via a third-party BSP.

## Tech stack (do not substitute without asking)

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma ORM
- MySQL (Hostinger-hosted) — **one shared database**, not one per clinic
- Auth.js (NextAuth.js) — Credentials provider, with email verification gating login
- WhatsApp messaging via a third-party BSP (provider TBD — see PRD Section 10)

## Ground rules

- **Follow the PRD exactly.** Don't add tables, fields, pages, or features
  that aren't in `/docs/PRD.md`. If something is ambiguous or missing, stop
  and ask instead of guessing.
- **Scoping, not isolation.** Every clinic-scoped table carries `clinic_id`;
  every account-scoped table carries `account_id`. Enforce scoping in every
  API route by deriving the account/clinic from the authenticated session —
  never trust a client-supplied ID alone. See the `multi-clinic-data-model`
  skill for the full pattern.
- **RBAC is server-side.** Every mutating API route calls `lib/rbac.ts`'s
  permission check before writing. Hiding a button in the UI is not access
  control.
- **Audit log is append-only.** Every registration edit writes a
  `registration_edit_log` row. Never update or delete these rows.
- **WhatsApp compliance.** Only BSP-approved templates are sendable. No
  free-text outbound messaging.
- **Build order.** Unless told otherwise: scaffold → auth (signup + email
  verification + login) → clinics → doctors → patient registration → revenue
  reports → notifications → roles/settings → WhatsApp. Each stage depends on
  schema/data from the one before it.
- **IVR is out of scope for MVP.** Don't build Twilio integration unless
  explicitly asked to revisit it.

## When unsure

Ask before assuming. A wrong assumption in the data model or RBAC layer is
expensive to unwind once real accounts and clinics exist on top of it.