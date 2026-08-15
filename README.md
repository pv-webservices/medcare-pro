# Automated Clinic Management System

Multi-tenant clinic management web app. This repo is the **template for one clinic
instance** — it gets cloned and deployed separately per clinic, each pointing at its
own dedicated MySQL database (`DATABASE_URL`). There is no shared-table + `clinic_id`
filtering anywhere; tenancy is the deployment.

Source of truth: [`docs/PRD.md`](docs/PRD.md) (what to build) and
[`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) (where it lives).

## Stack

| Layer | Choice |
|---|---|
| Frontend/Backend | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 |
| ORM | Prisma |
| Database | MySQL (Hostinger, one isolated DB per clinic) |
| Auth | Auth.js (NextAuth) |
| Messaging | WhatsApp Cloud API (Meta) — approved templates only |
| Voice | Twilio (IVR / DTMF capture) |

## Getting started

```bash
npm install
cp .env.example .env      # fill in this clinic's values
npx prisma generate
npx prisma migrate dev    # requires a reachable DATABASE_URL
npm run dev
```

## Status

**Scaffolding only.** The folder structure, Prisma schema, and API route wiring
are in place; every API route currently returns `501 Not Implemented` and every
page is a placeholder.

Build order (per `docs/CLAUDE.md`): scaffold → auth → patients → appointments →
dashboard → WhatsApp → Twilio IVR.

| Stage | Where it lives |
|---|---|
| 1 — Patient & appointment records | `src/app/(dashboard)/patients`, `.../appointments`, `src/app/api/patients`, `src/app/api/appointments` |
| 2 — Live dashboard | `src/app/(dashboard)/dashboard`, `src/components/dashboard` |
| 3 — WhatsApp communication | `src/app/(dashboard)/messages`, `src/app/api/whatsapp`, `src/lib/whatsapp.ts` |
| 4 — Smart receptionist (IVR) | `src/app/(dashboard)/receptionist`, `src/app/api/twilio`, `src/lib/twilio.ts` |
| 5 — Secure per-clinic setup | `.env.example`, `src/lib/auth.ts` |

## Per-clinic deployment

Each clinic gets its own `DATABASE_URL`, its own `NEXTAUTH_SECRET` and admin
credentials, and its own subdomain. Nothing clinic-specific is hardcoded — it all
comes from the environment.
