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

Run it after any change to the default permission sets in
`src/lib/defaultRoles.ts` — it backfills every existing account. Note that it
**overwrites** a seeded role's permissions, so hand edits made to Owner, Admin
or Staff on the Roles screen are reverted by a re-seed. Custom roles are never
touched.

## Status

**All eight stages built.** Auth, clinics, doctors, patient registration with
its audit trail, revenue reports, notifications, roles/settings and WhatsApp
messaging are implemented.

One module is still blocked on a vendor decision and is stubbed to throw rather
than guess (see [`docs/PRD.md`](docs/PRD.md) §10):

| Module | Blocked on |
|---|---|
| `src/lib/email.ts` | Transactional email provider — blocks FR-1.2 signup verification end-to-end |

**WhatsApp provider: RkvRobo** (`https://bot.rkvrobo.in/api`), configured in
`.env`. It is a gateway driving real WhatsApp devices, **not an official BSP**,
which changes two things the PRD assumed:

- **No provider-side template approval.** The approved message set lives in
  this app (`whatsapp_templates`, editable under Messages) and no endpoint
  accepts a free-typed body. That is a weaker guarantee than a BSP's review —
  an admin can write anything into a template — but it keeps outbound traffic
  to a small reviewed set.
- **Webhooks exist, but are unsigned.** RkvRobo posts to a URL pasted per
  device on its Devices page. It sends no signature, so the only verifiable
  secret is one we put in the URL ourselves — register
  `https://<your-app>/api/whatsapp/webhook?token=$WHATSAPP_WEBHOOK_TOKEN` and
  the route compares it in constant time, failing closed when unset.
  Its payload shape is undocumented: only shapes evidenced by the provider's
  own send responses are applied, and anything else is logged by key name (never
  by value) rather than guessed at.

Endpoint slugs differ from their doc-page titles in several places — verified
live: "Communicating SMS" **is** `/send-message`, "Device Info" is
`/info-devices`, "User Info" is `/info-user`, "Generate QR" is `/generate-qr`,
and "Send Text To Channel" is `/send-text-channel`.

Build order (per [`CLAUDE.md`](CLAUDE.md)):

| Stage | Where it lives | Status |
|---|---|---|
| 1 — Auth (signup, verification, login) | `src/app/(auth)`, `src/app/api/auth`, `src/lib/auth.ts`, `src/lib/email.ts` | Built (email send vendor-blocked) |
| 2 — Clinics | `src/app/(dashboard)/clinics`, `src/app/api/clinics` | Built |
| 3 — Doctors | `src/app/(dashboard)/doctors`, `src/app/api/doctors` | Built |
| 4 — Patient registration + audit trail | `src/app/(dashboard)/registration`, `src/app/api/registrations` | Built |
| 5 — Revenue reports | `src/app/(dashboard)/reports`, `src/app/api/reports` | Built |
| 6 — Notifications | `src/app/(dashboard)/notifications`, `src/app/api/notifications`, `src/lib/notifications.ts` | Built |
| 7 — Roles & settings | `src/app/(dashboard)/settings`, `src/app/api/roles`, `src/lib/roles.ts`, `src/lib/permissions.ts` | Built |
| 8 — WhatsApp | `src/app/(dashboard)/messages`, `src/app/api/whatsapp`, `src/lib/whatsapp.ts`, `src/lib/whatsappTemplates.ts` | Built |

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
- **No self-escalation through the roles editor.** A user may only grant
  permissions they hold themselves, the `*` wildcard is never mintable from the
  UI, and no edit may leave the account without an account-wide owner. See
  `src/lib/roles.ts`.
- **Hiding a nav tab is not access control.** `src/lib/navigation.ts` drops tabs
  a role cannot reach, but every page behind them still checks server-side and
  refuses anyone who types the URL directly.
- **No free-text WhatsApp.** Sends name a `whatsapp_templates` row and a list of
  patient ids — never a message body, never a raw phone number. Numbers are read
  from the patient record server-side, so the account's WhatsApp device cannot
  be used to message an arbitrary phone.
