---
name: multi-clinic-data-model
description: Conventions for Prisma schema, RBAC scoping, and audit logging for MEDCARE PRO's single shared platform (one account can own multiple clinics). Use whenever touching prisma/schema.prisma, any API route, or lib/rbac.ts. Replaces the old prisma-multitenant-mysql skill — delete that folder.
---

# Multi-Clinic Data Model & Scoping

MEDCARE PRO is **one shared application and one shared database.** An `Account`
(the business that signed up) can own multiple `Clinic` records. This is the
opposite of an earlier draft of this project that used one isolated database
per clinic — that model is gone. If you see a reference to it anywhere
(comments, old docs), it's stale.

## Hard rules

- **Every clinic-scoped table must carry `clinic_id`.** `patients`, `doctors`,
  `registrations`, `doctor_availability`, `doctor_leave`, `whatsapp_messages`
  all belong to a clinic.
- **Every account-scoped table must carry `account_id`.** `users`, `roles`,
  `clinics`, `notifications` (nullable `clinic_id` for account-wide ones).
- **Never trust a client-supplied `clinicId` or `accountId` on its own.**
  Always derive the account from the authenticated session, then verify the
  requested `clinicId` actually belongs to that account before querying or
  writing. A Staff-scoped user must additionally be checked against their
  `user_roles.clinic_id` assignment.

## RBAC — enforce server-side, always

- `lib/rbac.ts` exposes a permission check (e.g. `can(user, 'registration:edit', clinicId)`).
  Every API route that mutates data calls this before touching Prisma — never
  rely on the UI hiding a button as the only protection.
- Role scope: a `user_roles` row with `clinic_id = null` is account-wide; a row
  with a `clinic_id` set is scoped to only that clinic. A user can hold
  different roles in different clinics under the same account.

## Audit logging

- Any write to `registrations` (create, update) must also write a
  `registration_edit_log` row: who, their role at the time, what changed,
  when. This log is **append-only** — never update or delete a log row, not
  even for Owner-role cleanup.
- Edit history is visible only to Owner/Admin roles. A Staff role can trigger
  an edit (which still gets logged) but cannot view the log — enforce this in
  the API response, not just by hiding a UI tab.

## Patient IDs

- `patient_code` (format `PT-YYYY-####`) is generated server-side on
  creation, sequential, scoped account-wide (not per-clinic) per the current
  PRD assumption. If that assumption changes to per-clinic numbering, this
  generation logic needs updating in one place — keep it in a single
  `lib/generatePatientCode.ts` helper, don't inline the logic per call site.

## Migrations

- Standard Prisma workflow: `prisma migrate dev` locally, `prisma migrate
  deploy` in production. Since there's now only one database (not one per
  clinic), there's no "replay across N databases" concern from the old model
  — migrations run once, against the single shared DB.