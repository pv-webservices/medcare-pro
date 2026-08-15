# MEDCARE PRO — Agent Instructions

This file is read automatically by Claude (and referenced by other agents in this
workspace). Follow it before touching any code.

## Before doing anything

1. Read `/docs/PRD.md` in full — product scope, functional requirements,
   data model, and API endpoints.
2. Read `/docs/PROJECT_STRUCTURE.md` in full — the exact folder/file layout
   to follow.

Do not start writing code, running commands, or creating files until both
have been read.

## What this project is

MEDCARE PRO — a multi-tenant clinic management web app. Each clinic gets its
own isolated deployment: own database, own admin login, own patient data.
Core features: patient/appointment management, a live revenue/patient
dashboard, WhatsApp template messaging + automated reminders, and a Twilio-based
after-hours IVR receptionist.

## Tech stack (do not substitute without asking)

- Next.js (App Router) + TypeScript + Tailwind CSS
- Prisma ORM
- MySQL (Hostinger-hosted, one isolated DB per clinic)
- Auth.js (NextAuth.js)
- WhatsApp Cloud API (Meta) — template messages only, no free-form sends
- Twilio — IVR / DTMF capture

## Ground rules

- **Follow the PRD exactly.** Don't add tables, fields, pages, or features
  that aren't in `/docs/PRD.md`. If something is ambiguous or missing, stop
  and ask instead of guessing.
- **Follow the structure doc exactly.** File and folder names, locations,
  and route paths should match `/docs/PROJECT_STRUCTURE.md`.
- **Multi-tenancy = isolation, not filtering.** Each clinic is its own
  database and deployment. Never build a shared-table + `clinic_id` filter
  pattern instead.
- **WhatsApp compliance.** Only Meta-approved templates are sendable from the
  app. No free-text outbound messaging.
- **Webhook security.** Twilio and WhatsApp webhook routes must validate the
  incoming request signature before processing anything.
- **Build order.** Unless told otherwise, build in this order: scaffold →
  auth → patients → appointments → dashboard → WhatsApp → Twilio IVR. Each
  stage depends on data/schema from the one before it.
- **One clinic template.** This codebase is the template that gets cloned
  per clinic. Don't hardcode any single clinic's name, phone number, or
  credentials anywhere — everything clinic-specific comes from environment
  variables.

## When unsure

Ask before assuming. A wrong assumption here gets cloned into every future
clinic deployment, so it's cheaper to ask than to fix later.