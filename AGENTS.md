# MEDCARE PRO — Agent Instructions (v2)

This is the one instruction file for every coding agent in this repository.
Codex and other AGENTS.md-aware agents read it directly; Claude reads it
through `CLAUDE.md`, which imports it. Follow it before touching any code.

> **v2 note:** the multi-tenancy model changed. This is now one shared platform,
> one database — an Account can own multiple Clinics. If any earlier docs, code
> comments, or skill files in this repo reference "one database per clinic,"
> they're stale — this file and `/docs/PRD.md` (v2) are current.

## Before doing anything

1. Read `/docs/PRD.md` (v2) in full — product scope, functional requirements,
   data model, and API endpoints.
2. Read `/docs/PROJECT_STRUCTURE.md` (v2) in full — the exact folder/file
   layout to follow.
3. If you were given a staged handoff prompt (for example from
   `docs/feature-removal-handoff-prompts.md` or `docs/crm-ai-handoff-prompts.md`),
   that prompt's DO / ACCEPTANCE / STOP AND ASK sections are the task contract.

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

## Skills

Project skills live in two mirrored folders with identical `SKILL.md` files:
`.agents/skills/` (read by Codex) and `.claude/skills/` (read by Claude).
Edit both copies together; `tests/unit/agentSkillsMirror.test.ts` fails if
they differ. Read the matching skill before working in its area:

| Skill | Read it before |
|---|---|
| `multi-clinic-data-model` | touching `prisma/schema.prisma`, any API route, or `src/lib/rbac.ts` |
| `admin-dashboard-ui` | building or styling a page under `src/app/(dashboard)` or a component under `src/components/` |
| `secure-webhooks` | building or touching `api/whatsapp/webhook` or any other inbound webhook route |

## Verification

Before calling work done, run what applies and report the real output:

- `npm run typecheck`, `npm run lint` (no new errors), `npm test`.
- Schema changes: `npx prisma validate`, then create migrations with
  `prisma migrate dev --create-only` against a **disposable local** database
  only, and review the SQL by hand.
- Database-touching checks run only against a local disposable database, never
  the Hostinger production database. Scripts that write data are dry-run by
  default and need `--apply` (plus `--allow-remote` for a non-local database).
- `npm run build` runs `prisma migrate deploy` against whatever `DATABASE_URL`
  points at — never run it with a production URL.

## Git

- Work on a feature branch; never commit to or push `main`. The owner reviews
  and merges every PR.
- Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- No new npm dependencies without asking.

## Plivo / Telephony

1. Before implementing or modifying Plivo-specific Voice, XML, IVR, DTMF, Dial, webhook, call-transfer, SIP, or telephony behavior, consult the configured Plivo MCP `search_plivo` tool.
2. Prefer current Plivo documentation over remembered API syntax.
3. Never expose `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, SIP passwords, or provider secrets to browser/client code, logs, responses, tests using real values, MCP configuration, or source control.
4. Consider every inbound Plivo webhook untrusted until V3 signature validation succeeds.
5. Do not introduce a production bypass for Plivo signature verification.
6. Keep Plivo transport and XML logic under the telephony layer. Do not embed Plivo SDK calls directly inside appointment domain services.
7. Reuse existing MedCare appointment availability and booking domain logic. Never build a separate appointment engine for IVR.
8. Telephone appointment booking must reuse the existing `DoctorScheduleLock` concurrency protection.
9. Any Plivo callback that produces a persistent side effect must be idempotent. Before appointment booking is enabled through an action callback, design an idempotency key using `CallUUID` plus the relevant IVR/action context.
10. Do not trust caller phone number as unique patient identity. Multiple patients may share a phone number.
11. Never create appointments using placeholder patient names merely because caller identification is ambiguous.
12. Do not introduce AI voice, speech recognition, recording, VideoSDK, or another telephony provider unless explicitly requested.
13. Recording remains off by default.

### Initial IVR Scope

The deterministic V1 menu is:

- `1` -> tomorrow slots
- `2` -> appointment booking
- `3` -> urgent assistance
- `4` -> clinic information
- `9` -> repeat menu

Do not expand this scope without explicit approval.

### Emergency Handling

Do not provide AI medical diagnosis or emergency triage. The urgent/emergency flow must eventually provide appropriate emergency guidance and may transfer to a configured clinic on-call destination.

### Testing

For telephony changes:

- Run focused Plivo unit tests.
- Run `npm run typecheck`.
- Lint all touched files.
- Never perform paid Plivo calls automatically.
- Never buy or rent numbers automatically.
- Never modify Plivo billing automatically.
- Treat real phone calls as manual acceptance tests.
- Do not place real secrets in test fixtures.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
