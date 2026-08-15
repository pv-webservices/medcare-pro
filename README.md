# MEDCARE PRO

Multi-clinic management platform. **One shared application, one shared database.**
A business signs up once, creating a `Tenant`, and can then manage many clinics
under that single login — each with its own doctors, patients and revenue.

Isolation is by column, not by deployment: every account-scoped table carries
`tenant_id`, every clinic-scoped table carries `clinic_id`, and every query is
filtered from the authenticated session. (This reverses the v1 design, which
deployed a separate instance and database per clinic.)

Source of truth: [`docs/PRD.md`](docs/PRD.md) (what to build) and
[`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) (where it lives).

## Stack

| Layer | Choice |
|---|---|
| Frontend/Backend | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 |
| ORM | Prisma |
| Database | MySQL (Hostinger) — one shared database |
| Auth | Auth.js (NextAuth), Credentials + JWT sessions, email-verification gated |
| Access control | Custom RBAC, enforced server-side in `src/lib/rbac.ts` |
| Messaging | WhatsApp via a third-party BSP — approved templates only |

## Getting started

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and NEXTAUTH_SECRET
npx prisma generate
npx prisma migrate dev    # requires a reachable DATABASE_URL
npm run dev
```

`npm run prisma:seed` seeds the default Owner/Admin/Staff roles. Roles are
created per tenant at signup, so on a fresh database this is a no-op.

## Status

**Scaffolding only.** The folder structure, Prisma schema and API route wiring
are in place; every API route currently returns `501 Not Implemented` and every
page is a placeholder.

Two modules are blocked on vendor decisions and are stubbed to throw rather than
guess (see [`docs/PRD.md`](docs/PRD.md) §10):

| Module | Blocked on |
|---|---|
| `src/lib/email.ts` | Transactional email provider — blocks FR-1.2 signup verification end-to-end |
| `src/lib/whatsapp.ts` | WhatsApp BSP — auth scheme, payload shape and webhook signature format all differ per provider |

Build order (per [`CLAUDE.md`](CLAUDE.md)):

| Stage | Where it lives |
|---|---|
| 1 — Auth (signup, verification, login) | `src/app/(auth)`, `src/app/api/auth`, `src/lib/auth.ts`, `src/lib/email.ts` |
| 2 — Clinics | `src/app/(dashboard)/clinics`, `src/app/api/clinics` |
| 3 — Doctors | `src/app/(dashboard)/doctors`, `src/app/api/doctors` |
| 4 — Patient registration + audit trail | `src/app/(dashboard)/registration`, `src/app/api/registrations` |
| 5 — Revenue reports | `src/app/(dashboard)/reports`, `src/app/api/reports` |
| 6 — Notifications | `src/app/(dashboard)/notifications`, `src/app/api/notifications` |
| 7 — Roles & settings | `src/app/(dashboard)/settings`, `src/app/api/roles`, `src/lib/rbac.ts` |
| 8 — WhatsApp | `src/app/(dashboard)/messages`, `src/app/api/whatsapp`, `src/lib/whatsapp.ts` |

IVR / after-hours smart receptionist is **out of MVP scope** and its Twilio
scaffolding has been removed.

## Non-negotiables

- **Scope every query.** Derive `tenantId` from the session, never from the
  request. Verify a client-supplied `clinicId` belongs to that tenant before
  using it.
- **RBAC is server-side.** Every mutating route calls `requirePermission` from
  `src/lib/rbac.ts` before touching Prisma.
- **The audit log is append-only.** Every registration edit writes a
  `registration_edit_log` row; nothing updates or deletes one.
