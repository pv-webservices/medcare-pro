# Practice CRM & AI Assistant — Coding-agent handoff prompts (CR-1 → CR-6, AS-0 → AS-3)

Run these **in order, one per session and one branch/PR each**. Merge each one
before starting the next. Each prompt is self-contained: paste it as-is,
including the GROUND RULES block.

Before handing off each stage, the orchestrator re-verifies the repo:
`git log --oneline`, the previous stage's files, and a grep for stub markers
(`notImplemented`, `TODO`, fake data). A stage is "done" only when its
acceptance list passes on `main`.

**Spec:** `docs/crm-ai-prd.md` (committed in CR-1).
**Prerequisite:** RM-1 and RM-2 (feature removal) are merged. CR-1 checks this.

**Answer the PRD §0 decisions before the stage that needs them:**
O1 and O8 before CR-1 · O2, O3, O4, O6 before AS-0 · O5 before AS-3.

**Recommended order (PRD O7):** CR-1 → CR-2 → AS-0 → AS-1 → AS-2 → AS-3 → CR-3
→ CR-4 → CR-5 → CR-6. AS-* need AS-0. AS-2 needs CR-1. The AS-1 tools for
expenses and enquiries are added in CR-3 and CR-4.

---

## Shared rules (paste into every prompt)

```
GROUND RULES — read before writing any code
1. Read CLAUDE.md, AGENTS.md, docs/PRD.md and docs/crm-ai-prd.md in full. The
   CRM/AI PRD is the source of truth for this module. Do NOT add tables,
   columns, pages, permissions, settings or features it does not list.
2. No new npm dependencies. The AI provider is called with fetch. CSV uses
   src/lib/csv.ts. Files use the existing media storage/validation helpers.
3. Scope from the session, never from the request body. Tenant, clinic,
   patient, registration, doctor, numbers, statuses, totals and snapshots are
   always derived server-side. Client bodies are strict Zod objects.
4. Server-side RBAC on every route (src/lib/rbac.ts) AND the stage's feature
   entitlement (src/lib/features.ts / moduleFeatures.ts). Out-of-scope IDs
   return the same not-found response other modules use. When the feature is
   off for a tenant, its nav, pages, routes and dashboard cards are
   unreachable and every other module behaves exactly as today.
5. Money: Decimal(10,2) in the DB, 2-decimal strings in the app, integer paise
   in pure math (reuse src/lib/billing/invoiceMath.ts). Never float money
   arithmetic. Display with formatRupees (src/lib/money.ts).
6. AI never writes to the database (PRD D1). AI output only pre-fills a form or
   a message that a person saves or sends through the normal path. AI reads
   only through the typed read-only tools in src/lib/assistant/tools/ that call
   existing lib functions AS THE ACTOR (D2). No clinical text is ever sent to
   the provider (D4). No prompts, answers or tool results are stored (D5).
7. Domain language: "Registration/visit", never "Appointment", for the visit.
   "Follow-up", "Enquiry", "Estimate", "Expense" — never "lead", "deal",
   "customer".
8. Follow existing patterns: Tasks (src/lib/tasks.ts, taskAuthority.ts) for
   assignment and lifecycle; billing (src/lib/billing/*) for numbering,
   snapshots, revision locks, print route groups and backfill/verify scripts;
   reports (reports.ts, reportPeriods.ts, KpiTiles, GrowthChart,
   BreakdownTable, ExportCsvLink) for periods, charts and exports;
   notifications.ts for notify* helpers; rateLimit.ts for limits.
9. This Next.js version has breaking changes. Read node_modules/next/dist/docs/
   for anything routing/data related before writing it.
10. STOP AND ASK (do not guess) if: the spec is silent or contradicts the code;
    a migration would alter or drop an existing column (CR-1's two ADD columns
    are the only approved change to an existing table); an existing test must
    be changed to pass; you need to change registrations, billing,
    prescriptions or appointment behaviour beyond what the stage names; or
    anything would change existing tenants' roles outside the dry-run backfill.
11. Finish with: npm run typecheck, npm run lint (touched files), npm test,
    npm run build, and the stage's own checks. Report a file manifest
    (added/modified) and test results in the PR description. Never call the
    real AI provider in tests; use the fake in tests/fakes/assistant/. Do not
    deploy, do not run remote migrations, and do not run any backfill with
    --apply against a remote database.
```

---

## CR-1: Follow-ups (Tasks linked to patients and visits) + catalogue backfill tool

```
TASK: MedCare Pro — Practice CRM stage CR-1 (follow-ups). Branch: feat/crm-1-follow-ups

[Paste GROUND RULES above]

CONTEXT
Clinics need to track "review in 7 days", "collect report", "call back" per
patient. MedCare already has a Tasks module (src/lib/tasks.ts, the tasks
table, task:* permissions, a dashboard tasks card). A follow-up is a Task with
a patient (and optionally a visit) attached. Spec: docs/crm-ai-prd.md §4.1
(FR-13.1 to FR-13.6), §3, §6 "Changes to existing tables", §8, D9, O1, O8.

FIRST, VERIFY
- RM-1 and RM-2 are merged: `grep -rnE "clinical-ai|DashboardLayout"
  src` returns nothing. If not, STOP and report.
- The owner has answered O1 (tasks columns) and O8 (click-to-chat). If the
  PR description template or the task message does not state the answers,
  STOP AND ASK.

DO
1. docs:
   - Add docs/crm-ai-prd.md (copy provided by the orchestrator).
   - Apply the CR-1 part of PRD §11 to docs/PRD.md.
   - If O8 = "No, with amendment": add the click-to-chat sentence from O8 to
     CLAUDE.md under "WhatsApp compliance", word for word.
2. Generic catalogue backfill (used by every later stage):
   - src/lib/catalogueRoleMigration.ts: planRoleTopUp(role, snapshot,
     grants) with the same statuses as src/lib/billingRoleMigration.ts
     (ELIGIBLE only when the stored permission array equals the snapshot
     exactly). Unit test.
   - src/lib/roleSnapshots/<stage>.json: literal snapshot of the current
     system role arrays (CLINIC_ADMIN, RECEPTIONIST, STAFF, DOCTOR) on main.
     Create crm-1.json now.
   - scripts/backfill-feature.mts --stage=<stage>: dry run by default,
     --apply, --allow-remote for non-local DATABASE_URL. Installs the stage's
     feature rows and default-plan links if absent, and applies role
     top-ups only for ELIGIBLE roles. Stage definitions (feature keys,
     grants) live in src/lib/catalogueStages.ts. Model it on
     scripts/backfill-billing.mts.
   - scripts/verify-feature.mts --stage=<stage>: read-only checks for the
     stage's tables, unique indexes and feature rows.
   - package.json: "catalogue:backfill", "verify:catalogue".
3. prisma/schema.prisma + migration <timestamp>_crm_follow_ups (generated with
   `prisma migrate dev --create-only` on a DISPOSABLE local DB, reviewed by
   hand):
   - tasks: ADD nullable patient_id and registration_id (FK Restrict) and the
     three indexes in PRD §6. Nothing else changes on tasks.
   - CREATE follow_up_templates and follow_up_contact_logs per PRD §6.
   - Back-relations only on Patient, Registration, Clinic, Tenant, User.
4. Catalogue: feature `follow_ups` per PRD §3 (requires `tasks`: if tasks is
   off, follow_ups is treated as off). Map it in moduleFeatures.ts. No new
   permissions. Audit actions FOLLOW_UP_CREATED, FOLLOW_UP_CONTACTED.
5. src/lib/followUps.ts:
   - createFollowUp(actor, registrationId, input): loads the registration
     with scope, derives tenant/clinic/patient, then calls the existing
     createTask path (extend it to accept patientId/registrationId
     server-side only; the public createTaskSchema must NOT accept them).
     Presets and due-date quick picks per FR-13.2; due dates in India time.
   - listFollowUpsForPatient(actor, patientId), listOpenFollowUpsForPatient.
   - logFollowUpContact(actor, taskId, channel).
   - getFollowUpTemplate / saveFollowUpTemplate(actor, clinicId) with
     default EN/HI templates and placeholders {patientFirstName},
     {clinicName}, {clinicPhone}, {dueDate}; buildWhatsappLink(mobile,
     message) with Indian mobile normalisation and encodeURIComponent.
   - Extend listTasks filters with followUpsOnly, dueToday, overdue (India
     time). Extend taskDashboardSummary with followUpsDueToday and
     followUpsOverdue when the feature is on.
6. API routes per PRD §7 (follow-ups, contact-log, settings/follow-ups).
7. UI:
   - Registration detail page: "Add follow-up" button + modal (task:create);
     a "Follow-ups" card listing this patient's open and recent follow-ups,
     each with Mark done (task:complete) and Remind via WhatsApp.
   - Open-follow-ups banner on the registration page of a NEW visit for a
     patient with open follow-ups (FR-13.5).
   - Tasks page: Follow-ups / Due today / Overdue filters; each follow-up row
     shows the patient name + code linking to the registration (CR-2 changes
     the link to the timeline).
   - /settings/follow-ups: per-clinic template editor; add to
     settingsSections.ts (view task:view, manage task:manage).
   - Dashboard tasks card shows the two new counts.
8. Tests:
   - unit: date quick picks at IST midnight; template rendering and wa.me
     encoding for Hindi text; createTaskSchema still rejects patientId.
   - DB script scripts/test-follow-ups.mts (pattern: scripts/test-billing.mts):
     cross-tenant/clinic IDs → not found; patient must match registration;
     Staff without task:create cannot add; contact log has no body column;
     follow_ups off → registration page and tasks behave exactly as before;
     tasks off → follow_ups off.
   - package.json "test:follow-ups".

DO NOT build the patient timeline, global search or any AI here.

ACCEPTANCE
- typecheck/lint/test/build pass; test:follow-ups passes on a disposable DB.
- The migration only ADDs two nullable columns + indexes to tasks and CREATEs
  two tables; paste the SQL in the PR.
- Existing Tasks tests pass unchanged.
- catalogue:backfill --stage=crm-1 dry run lists eligible roles; after a local
  --apply, verify:catalogue --stage=crm-1 passes.

STOP AND ASK if createTask cannot take server-side patient/registration
without changing its public behaviour, or if a current system role array on
main differs from defaultRoles.ts.
```

---

## CR-2: Patient timeline + global search

```
TASK: MedCare Pro — Practice CRM stage CR-2 (timeline + search). Branch: feat/crm-2-timeline-search

[Paste GROUND RULES above]

CONTEXT
CR-1 is merged. Spec: docs/crm-ai-prd.md §4.2 (FR-13.7 to FR-13.9), §3
(patient:timeline:read, search:use). Verify CR-1 is on main.

DO
1. Permissions: patient:timeline:read (group "Patients") and search:use
   (group "Search") with default grants per PRD §3; role snapshot
   src/lib/roleSnapshots/crm-2.json; stage "crm-2" in catalogueStages.ts (no
   feature row: these are permission-gated only).
2. src/lib/patientTimeline.ts: getPatientTimeline(actor, patientId) returns
   { patient, sections[] } where each section is included only when its
   feature AND permission are present, built ONLY from existing functions:
   listPatientVisitsForActor, listInvoicesForActor (patient filter; add one
   if missing, without changing existing callers), listPatientPrescriptions,
   listAppointments (patient filter), listFollowUpsForPatient, and estimates
   later (CR-5 adds that section). Merge into one reverse-chronological
   list with typed entries. Every query scoped through the actor.
3. /patients/[id] page: header + timeline + section filter chips; each entry
   links to its record. Mobile shown in full only to users with patient:read
   (as elsewhere).
4. Link patient names/codes to /patients/[id] (FR-13.8) in registration list
   and detail, dues, invoice list/detail, prescriptions list, follow-ups —
   only when the viewer holds patient:timeline:read. Do not change any other
   behaviour on those pages.
5. Global search:
   - src/lib/globalSearch.ts: searchForActor(actor, q) using
     findPatientsForActor, registration lookup, invoice-number lookup; each
     group present only with that module's feature + read permission;
     max 5 per group; q trimmed, 2–60 chars.
   - GET /api/search?q= with a new rate-limit policy (30/min per user).
   - A CommandPalette component (Ctrl-K / ⌘-K, header icon, keyboard
     navigation, Esc closes) in the dashboard layout, rendered only for
     users with search:use.
6. Navigation: no new nav entry (timeline is reached from links and search).
7. Tests:
   - unit: timeline merge order and section omission by permission.
   - DB script scripts/test-patient-timeline.mts: a Doctor without
     invoice:read sees no bills section and no bills in search; billing off
     → no bills anywhere; cross-tenant patient → not found; search returns
     only the actor's clinics; rate limit.
   - Playwright smoke: Ctrl-K → type a patient name → open timeline.

DO NOT add enquiries or estimates to search/timeline yet (CR-4/CR-5 do).

ACCEPTANCE: typecheck/lint/test/build pass; test:patient-timeline passes;
existing page tests pass unchanged; screenshots of the timeline for Owner and
Doctor in the PR.

STOP AND ASK if a needed list function has no patient filter and adding one
would change an existing caller's results.
```

---

## AS-0: AI governance foundation (no user-facing AI yet)

```
TASK: MedCare Pro — AI Assistant stage AS-0 (governance). Branch: feat/ai-0-governance

[Paste GROUND RULES above]

CONTEXT
This lays the foundation for every AI feature: entitlement, tenant settings,
budget, usage metadata, the provider client and the patient-data policy.
Spec: docs/crm-ai-prd.md §5.1 (FR-14.1 to FR-14.6), §2 D1–D6, §6 (ai_*
tables), §9, O2/O3/O4/O6. Note RM-1 deleted the old src/lib/ai/ Gemini code
and the AI_ENABLED/GEMINI_* env vars; do NOT restore them. New code lives in
src/lib/assistant/. Verify CR-2 is on main and src/lib/ai does not exist.

DO
1. docs: apply the AS-0 part of PRD §11 to docs/PRD.md; add PRD §9 env vars to
   .env.example with comments.
2. Schema + migration <timestamp>_ai_assistant_foundation: CREATE
   ai_tenant_settings, ai_usage_events, ai_user_settings (enum AiFeature with
   ASK, DRAFT_FOLLOW_UP, DRAFT_BILL_LINES, DRAFT_DUES_REMINDER, BRIEFING).
   CREATE only. Back-relations only.
3. Catalogue: feature `ai_assistant` (PREMIUM, globalEnabled true,
   inDefaultPlan false); permissions ai:use, ai:settings:manage,
   ai:briefing:receive (group "AI Assistant") with grants per PRD §3; audit
   actions AI_SETTINGS_UPDATED, AI_NOTICE_ACKNOWLEDGED; notification types
   ai.budget_80, ai.budget_exhausted; stage "as-0" in catalogueStages.ts with
   roleSnapshots/as-0.json.
4. src/lib/assistant/:
   - config.ts: reads AI_ASSISTANT_ENABLED, ANTHROPIC_API_KEY,
     AI_ASSISTANT_MODEL, AI_DEFAULT_MONTHLY_TOKENS, AI_TIMEOUT_MS lazily;
     never throws at import time.
   - availability.ts: getAiAvailability(actor) per FR-14.2, returning
     {available, reason: "FEATURE_OFF"|"TENANT_OFF"|"NOT_CONFIGURED"|
     "BUDGET_SPENT"|"NO_PERMISSION"|"NOTICE_REQUIRED"}. The only gate used by
     pages and routes.
   - provider.ts: the ONLY caller of the Anthropic Messages API (fetch,
     timeout, one retry with back-off on 429/5xx, tool-use request/response
     types, error mapping to PROVIDER_TIMEOUT | PROVIDER_ERROR |
     PROVIDER_REFUSED). Check the current Anthropic API reference for the
     request shape, headers and version header; cite it in a comment.
   - usage.ts: recordUsage(...) and monthUsage(tenantId, now) (India-time
     month); raises ai.budget_80 / ai.budget_exhausted once per month.
     A budget check + call + record wraps every provider use in one helper,
     runAiCall(actor, feature, fn).
   - redact.ts: applyPatientPolicy(value, settings) per FR-14.5 — names to
     "Patient {code}" unless allow_patient_names; mobiles always last-4.
   - settings.ts: getAiTenantSettings, saveAiTenantSettings (ai:settings:
     manage; monthly_token_budget not editable by tenants),
     acknowledgeNotice(actor).
   - messageSafety.ts: checkMessageSafety(text, ctx) used by AS-2: blocks
     clinical terms (a small list in clinicalTerms.ts: diagnosis, disease and
     procedure words in English + common Hindi transliterations), phone
     numbers other than the clinic's, and length > 500.
5. Platform super-admin: on the existing platform tenant screen, add a
   "Monthly AI token budget" field for the tenant (follow how other
   platform-level tenant settings are edited; if there is no such screen,
   STOP AND ASK).
6. API: GET/PUT /api/settings/ai, POST /api/ai/acknowledge.
7. UI: /settings/ai (settingsSections.ts; view ai:use, manage
   ai:settings:manage): switch, "Allow patient names in AI answers" with an
   explanation, briefing switch (wired in AS-3), usage this month by user and
   feature (from ai_usage_events), budget bar. A reusable AiNotice
   component for FR-14.6.
8. tests/fakes/assistant/: a deterministic fake provider (scripted tool calls
   and text, token counts) injected through provider.ts.
9. Tests:
   - unit: availability matrix (every reason); redaction both settings; month
     boundary at IST; budget 80% notification fires once; config missing →
     NOT_CONFIGURED without throwing; messageSafety rules.
   - DB script scripts/test-ai-governance.mts: Receptionist cannot change
     settings; tenant cannot change its budget; usage rows contain no text
     columns (assert the Prisma model fields); feature off → routes not
     found; ai:use without notice → NOTICE_REQUIRED.

DO NOT build Ask MedCare, drafts or briefing here.

ACCEPTANCE: typecheck/lint/test/build pass; test:ai-governance passes; grep
shows no fetch to api.anthropic.com outside provider.ts; the app boots and
every existing e2e suite passes with all AI env vars unset.

STOP AND ASK if the feature catalogue cannot express PREMIUM + not-in-default
-plan the way clinical_ai did, or there is no platform-level tenant settings
screen.
```

---

## AS-1: Ask MedCare (read-only questions over existing reports)

```
TASK: MedCare Pro — AI Assistant stage AS-1 (Ask MedCare). Branch: feat/ai-1-ask

[Paste GROUND RULES above]

CONTEXT
AS-0 is merged. Spec: docs/crm-ai-prd.md §5.2 (FR-14.7 to FR-14.11), D2, D3,
D5. Verify AS-0 is on main.

DO
1. src/lib/assistant/tools/: one file per tool from the FR-14.8 table that
   exists today (revenue_summary, collections_summary, dues_list,
   registration_counts, tasks_due, appointments_on). Each tool exports:
   - name, description, Zod input schema (converted to JSON schema for the
     provider), required feature + permissions
   - run(actor, input) that calls ONLY the named existing lib function,
     maps the result to a small typed output (no free-text clinical fields,
     max 20 rows), and passes it through applyPatientPolicy
   - toDisplay(output) for the "Data used" panel
   A registry builds the tool list PER ACTOR: a tool the actor cannot use is
   not sent to the model at all.
   registration_counts must return counts, not rows; if no counting function
   exists, add a count variant next to listRegistrationsForActor that reuses
   its scope and filters, without changing it.
2. src/lib/assistant/ask.ts: askQuestion(actor, {question, history}):
   - history: max 10 prior turns, each ≤ 2,000 chars, roles user|assistant
     only, text only (Zod). The client never sends tool results back.
   - System prompt per FR-14.10, including today's India date, the tenant's
     clinic names the actor may see, and the rule that tool output is data.
   - Tool-use loop, max 5 tool calls, via runAiCall(…"ASK"…).
   - Returns { answer, dataUsed: [{tool, display}] }. dataUsed is built from
     the server's own tool outputs, not from model text.
3. POST /api/ai/ask (ai:use + availability), new rate-limit policy
   20/hour/user, 409 with a friendly message on BUDGET_SPENT.
4. UI: "Ask MedCare" header button (only when available), a side panel with
   example questions in EN and HI, the conversation (React state only; cleared
   on reload), answer text, and a collapsible "Data used" section rendering
   tables with formatRupees and links (e.g. dues → /billing/dues). Show
   AiNotice first if needed. A footer line: "Answers come from your clinic
   data. Check important figures in Reports."
5. Tests (fake provider):
   - the tool list sent to the provider omits tools the actor lacks (assert
     captured payloads for Owner, Receptionist, Doctor)
   - a Doctor asking about revenue gets "I can't see that" and no
     revenue tool was available
   - dataUsed equals the tool output, even when the fake model text states a
     different number
   - patient names redacted when the setting is off; mobiles always masked
   - captured payloads never contain consultation/prescription fields
   - loop stops at 5 tool calls; provider timeout → friendly error, usage row
     with status
   - history validation rejects a "tool" role and over-long turns
   - feature off → button hidden, route not found
   - package.json "test:ai-ask"

ACCEPTANCE: typecheck/lint/test/build pass; test:ai-ask passes; a manual run
with the fake provider shows the panel at desktop and mobile widths
(screenshots in the PR).

STOP AND ASK if a report function cannot be called with a narrower filter
without changing it, or if the provider's tool-use format differs from what
provider.ts supports.
```

---

## AS-2: AI drafts — follow-up, bill lines, dues reminder

```
TASK: MedCare Pro — AI Assistant stage AS-2 (drafts). Branch: feat/ai-2-drafts

[Paste GROUND RULES above]

CONTEXT
AS-1 and CR-1 are merged. Spec: docs/crm-ai-prd.md §5.3 (FR-14.12 to
FR-14.14), D1, D9, O8. Every draft only fills a form; nothing is saved or sent
by the server. Verify AS-1 is on main.

DO
1. src/lib/assistant/drafts/followUp.ts: draftFollowUp(actor,
   {registrationId, instruction ≤ 200}) → validated {preset|title,
   dueInDays (1–365) | dueDate, priority, note ≤ 500}. Sends only the
   instruction, today's India date and the preset list. Needs ai:use +
   task:create + follow_ups.
2. src/lib/assistant/drafts/billLines.ts: draftBillLines(actor,
   {invoiceId, instruction ≤ 300}). Loads the draft invoice in scope (DRAFT
   only), sends the instruction and the names + ids of
   listBillableServicesForClinic(clinicId) — NO prices. Model returns
   [{serviceItemId, quantity 1–999}] + unmatched[]. Server drops unknown ids,
   then returns lines priced from the price list exactly as the editor's
   "add from price list" does. Needs ai:use + invoice:create + billing.
3. src/lib/assistant/drafts/duesReminder.ts: draftDuesReminder(actor,
   {invoiceId, language EN|HI|HINGLISH}). Input to the model: first name (or
   "Patient" when names are off), clinic name, clinic phone, invoice number,
   balance due as a string. Output text must pass checkMessageSafety;
   otherwise return the default template. Needs ai:use + invoice:read +
   billing.
4. API: POST /api/ai/draft/follow-up | bill-lines | dues-reminder (strict
   Zod, availability gate, rate limit 30/hour/user, all via runAiCall).
5. UI:
   - Add follow-up modal: a "Describe it" box + "Fill with AI" that fills the
     form fields; the user still clicks Save.
   - Bill editor (src/app/(dashboard)/registration/[id]/bill): a "Describe
     services" box + "Add with AI" that appends matched lines to the
     UNSAVED editor state and lists unmatched phrases as "Not in your price
     list"; the existing unsaved-changes warning applies. Save/Issue
     unchanged.
   - Dues list row: "Draft reminder" → modal with language picker, editable
     text, safety warnings, and "Open WhatsApp" (wa.me) which also POSTs a
     contact-log entry. If O8 = "yes" (BSP rule applies), show "Copy text"
     instead of Open WhatsApp.
   - Every AI button appears only when getAiAvailability is available AND the
     user holds the underlying permission.
6. Contact logging for dues: reuse follow_up_contact_logs ONLY if PRD §6 is
   amended; otherwise log an audit entry DUES_REMINDER_OPENED (add it to
   audit.ts) with invoice id and channel, no text. Choose the audit entry
   unless the orchestrator says otherwise.
7. Tests (fake provider):
   - bill lines: an invented serviceItemId is dropped; prices come from the
     price list even if the fake model returns a price; a non-DRAFT invoice
     → 409; another clinic's invoice → not found; nothing is written to
     invoice_lines by the draft route (count before/after)
   - follow-up: out-of-range dueInDays rejected; no consultation text in the
     captured payload
   - dues reminder: clinical term in model output → default template; other
     phone numbers blocked; first-name-only when names allowed, "Patient"
     when not
   - Receptionist with ai:use but without invoice:create cannot draft bill
     lines
   - package.json "test:ai-drafts"

ACCEPTANCE: typecheck/lint/test/build pass; test:ai-drafts and test:billing
pass; Playwright: describe services → lines appear unsaved → save → issue
works exactly as before.

STOP AND ASK if the bill editor cannot accept externally added lines without
changing its save contract.
```

---

## AS-3: Daily briefing email

```
TASK: MedCare Pro — AI Assistant stage AS-3 (daily briefing). Branch: feat/ai-3-briefing

[Paste GROUND RULES above]

CONTEXT
AS-2 is merged. Spec: docs/crm-ai-prd.md §5.4 (FR-14.15 to FR-14.17), O5.
There is no general cron entry point yet (the clinical-audio one was removed
in RM-1). Verify AS-2 is on main.

DO
1. Schema + migration: CREATE ai_briefing_deliveries. CREATE only.
2. src/app/api/cron/[job]/route.ts: POST only; Authorization Bearer
   CRON_SECRET compared with crypto.timingSafeEqual (401 otherwise); unknown
   job → 404; job "ai-briefing" runs runDailyBriefings(now). Returns a JSON
   summary {tenants, sent, skipped, failed}. Safe to call repeatedly.
3. src/lib/assistant/briefing.ts:
   - buildBriefingNumbers(actor, indiaDate): yesterday vs day before, using
     ONLY existing functions (getDailyRevenueSnapshot / reports, collections,
     dues, taskDashboardSummary, appointments, doctors on leave); each line
     only if the recipient holds the permission and feature.
   - summarise(numbers) via runAiCall(…"BRIEFING"…): ≤ 3 sentences, numbers
     only in, no names. On any failure or BUDGET_SPENT → no summary.
   - runDailyBriefings(now): for tenants with ai_assistant on, enabled and
     briefing_enabled; recipients = users with ai:briefing:receive and
     briefing_opt_in; one email per user per tenant per India date
     (ai_briefing_deliveries unique). Build the actor for each recipient the
     same way sessions do, so scope matches what they would see logged in.
   - Email via sendTransactionalEmail, plain + HTML, escapeHtml on all
     values, opt-out link to /settings/ai.
4. /settings/ai: "Send me the daily briefing" toggle (ai:briefing:receive)
   writing ai_user_settings.briefing_opt_in; the tenant briefing switch from
   AS-0 now takes effect.
5. docs: add a "Scheduler" section to the PR description: call
   POST https://<host>/api/cron/ai-briefing at 08:00 IST daily with the
   Bearer secret (hPanel cron, cron-job.org or GitHub Actions).
6. Tests (fake provider, fake email):
   - cron secret missing/wrong → 401; unknown job → 404
   - idempotent: two calls the same India day send one email per user
   - a user without report:read gets no revenue lines
   - AI failure → email still sent, no summary
   - email body has no patient names or mobiles (regex over fixtures)
   - opted-out user and tenant with briefing off get nothing
   - IST boundary: a call at 02:00 UTC uses the correct India date
   - package.json "test:ai-briefing"

ACCEPTANCE: typecheck/lint/test/build pass; test:ai-briefing passes; a sample
rendered email (fixture data) attached to the PR.

STOP AND ASK if building an actor for a user outside a request is not
supported by the session/RBAC helpers.
```

---

## CR-3: Clinic expenses + Profit report

```
TASK: MedCare Pro — Practice CRM stage CR-3 (expenses + profit). Branch: feat/crm-3-expenses

[Paste GROUND RULES above]

CONTEXT
Spec: docs/crm-ai-prd.md §4.3 (FR-13.10 to FR-13.13), §3 (expense:*), §6
(expense tables), D8. Verify the previous stage is on main.

DO
1. Schema + migration: CREATE expense_categories, expenses (enums
   ExpensePaymentMode, ExpenseStatus). Receipt FK to the existing media
   assets table if its model fits a private, tenant-scoped file; if it does
   not, STOP AND ASK before adding any storage code.
2. Catalogue: feature `expenses` (CORE, default plan), permissions
   expense:read/create/manage, grants per PRD §3, audit actions, stage
   "crm-3" + roleSnapshots/crm-3.json.
3. src/lib/expenses/: validation (Zod per FR-13.11), categories (lazy seed of
   defaults on first list per tenant, archive not delete, unique name),
   expenses service (create, update with the 7-day own-edit rule, archive,
   list with filters + total, export rows), receipt upload/download through
   existing media helpers with type/size checks and scoped download.
4. Profit: src/lib/expenses/profitReport.ts getProfitReport(actor, filters)
   using the SAME ReportFilters/period helpers as reports and
   getCollectionsReport for Collected; expenses by expense_date in India
   time; per-bucket series; by-category table. Do NOT change
   getRevenueReport or getCollectionsReport.
5. API per PRD §7 (expenses, categories, reports/profit + export).
6. UI: /expenses (list, filters, total, add/edit drawer, receipt preview,
   CSV export), /settings/expenses (categories), a "Profit" section on
   /reports gated per FR-13.13 with the disclaimer text, nav entry
   "Expenses" (expense:read + feature).
7. AS-1 tool: add expenses_summary to src/lib/assistant/tools/ (feature +
   expense:read) if AS-0/AS-1 are merged.
8. Tests: DB script scripts/test-expenses.mts — tenant/clinic isolation;
   7-day edit rule; archived excluded from totals and profit; profit =
   collected − expenses on a fixture with partial and voided payments;
   receipt of another clinic → not found; oversize/wrong type rejected;
   Staff cannot read. Unit tests for validation and bucket boundaries at IST
   midnight. package.json "test:expenses".

ACCEPTANCE: typecheck/lint/test/build pass; test:expenses and test:billing
pass; Revenue and Collections report outputs unchanged on the existing
fixtures.

STOP AND ASK if the period helpers cannot bucket a Date column (expense_date)
the same way they bucket instants.
```

---

## CR-4: Enquiries

```
TASK: MedCare Pro — Practice CRM stage CR-4 (enquiries). Branch: feat/crm-4-enquiries

[Paste GROUND RULES above]

CONTEXT
Spec: docs/crm-ai-prd.md §4.4 (FR-13.14 to FR-13.17), §3 (enquiry:*), §6,
D7, D9, O8. "Enquiry" is the only term: never "lead". Verify the previous
stage is on main.

DO
1. Schema + migration: CREATE enquiries, enquiry_contacts, enquiry_templates
   (enums EnquirySource, EnquiryStage, ContactChannel).
2. Catalogue: feature `enquiries`, permissions enquiry:read/create/convert,
   grants, audit actions, stage "crm-4" + snapshot.
3. src/lib/enquiries/: validation; service (create with duplicate check per
   FR-13.15 returning matches; update; changeStage with lost_reason rule;
   logContact; list with filters incl. next-contact due today/overdue in
   India time; board data by stage); conversion linking
   (linkConversion(actor, enquiryId, {appointmentId | registrationId}) which
   verifies the target exists in the same tenant and clinic and was created
   AFTER the enquiry, then sets BOOKED or VISITED); templates + wa.me link
   via the CR-1 helper; report data (by source, conversion rate).
4. Conversion UX: "Book appointment" (appointments feature) and "Register
   visit" open the EXISTING forms with name/mobile pre-filled via query
   parameters the forms already support (or add read-only prefill support
   without changing their submit behaviour). On successful save, the form
   calls linkConversion. If prefill would change those forms' validation or
   submit, STOP AND ASK.
5. API per PRD §7. UI: /enquiries list + board (drag between stages calls
   changeStage; LOST opens the reason modal), /enquiries/[id] with contact
   log, Remind via WhatsApp (or Copy text if O8 = yes), nav entry, an
   "Enquiries" card on /reports, and enquiries in global search and the AS-1
   tool registry (enquiries_summary) if those stages are merged.
6. Tests: DB script scripts/test-enquiries.mts — duplicate detection by
   mobile across enquiries and patients; LOST needs a reason; conversion
   links only same-clinic records created after the enquiry; Staff can read
   but not convert; isolation; conversion rate on a fixture. package.json
   "test:enquiries".

ACCEPTANCE: typecheck/lint/test/build pass; test:enquiries and
test:e2e:prescriptions pass; registration and appointment tests unchanged.

STOP AND ASK if the registration or booking forms cannot accept prefill
without behaviour changes.
```

---

## CR-5: Treatment estimates

```
TASK: MedCare Pro — Practice CRM stage CR-5 (estimates). Branch: feat/crm-5-estimates

[Paste GROUND RULES above]

CONTEXT
Spec: docs/crm-ai-prd.md §4.5 (FR-13.18 to FR-13.21), §6, D8. Reference
pattern: src/lib/billing/* (numbering with a locked counter, snapshot at
share, revision lock, print route group, InvoiceDocument). Verify the
previous stage is on main and billing is on main.

DO
1. Schema + migration: CREATE estimates, estimate_lines,
   estimate_number_sequences (enum EstimateStatus).
2. Catalogue: feature `estimates` (requires billing), permissions
   estimate:read/create/convert, grants, audit actions, notification type
   estimate.accepted, stage "crm-5" + snapshot.
3. src/lib/estimates/: create/save draft (lines from
   listBillableServicesForClinic or custom; totals via invoiceMath;
   revision → 409 when stale); share (locks the counter row, number
   EST-{FY}-{SEQ} with financialYear helper, frozen snapshot of clinic,
   patient, doctor, lines, totals); accept/decline; expiry computed on read
   (status shown as EXPIRED when SHARED and valid_until < today IST, stored on
   next write); convert per FR-13.21 using createDraftInvoice and
   saveDraftInvoice with the invoice's own revision, inside the visit lock
   (withVisitLock). Never touch an ISSUED invoice.
4. Print: src/app/(estimate-print)/estimates/[id]/print with an
   EstimateDocument component modelled on InvoiceDocument (do not fork
   InvoiceDocument; share small pieces only if no output changes for
   invoices). Title "Treatment Estimate" and the not-a-bill line. Drafts →
   not found.
5. API per PRD §7. UI: /estimates list, /estimates/new (patient picker via
   findPatientsForActor), /estimates/[id] (editor reusing
   InvoiceLineBuilder if it can be reused without behaviour change; else
   STOP AND ASK), Share, Accept/Decline, Convert (registration picker of the
   same patient + clinic), and an Estimates section in the patient timeline.
6. Tests: DB script scripts/test-estimates.mts — 20 concurrent shares give
   00001–00020 with no gaps; FY rollover; snapshot unchanged after profile
   edits; convert into a visit with no invoice creates a draft with the
   lines; convert into a visit with a DRAFT appends lines; ISSUED → refused;
   different patient's visit → refused; billing off → estimates off;
   invoice print output unchanged. package.json "test:estimates".

ACCEPTANCE: typecheck/lint/test/build pass; test:estimates, test:billing,
test:e2e:billing pass.

STOP AND ASK if InvoiceLineBuilder or InvoiceDocument cannot be reused
without changing invoice behaviour or output.
```

---

## CR-6: Owner data export

```
TASK: MedCare Pro — Practice CRM stage CR-6 (data export). Branch: feat/crm-6-data-export

[Paste GROUND RULES above]

CONTEXT
Spec: docs/crm-ai-prd.md §4.6 (FR-13.22), §3 (data:export). Verify the
previous stage is on main.

DO
1. Permission data:export (group "Data"), Owner/Clinic Admin only; audit
   action DATA_EXPORTED; stage "crm-6" + snapshot.
2. src/lib/dataExport.ts: one builder per dataset (patients, registrations,
   invoices, payments, expenses, enquiries, follow-ups), each using the
   module's existing scoped list/export function where one exists
   (listRegistrationsForExport, listDuesForExport style), with the module's
   feature + read permission also required. Columns documented in the file;
   numbers unformatted; dates ISO in India time; 50,000-row cap with a clear
   error. Streamed CSV via src/lib/csv.ts.
3. GET /api/exports/[dataset]?from=&to=&clinicId= (no-store; audit with
   dataset and row count only); /settings/data-export page listing datasets
   the actor may export.
4. Tests: isolation; a dataset whose feature is off is not offered and its
   route is not found; cap enforced; audit row has no data; CSV injection
   guard (cells starting with = + - @ are escaped as the existing CSV
   helper does). package.json "test:data-export".

ACCEPTANCE: typecheck/lint/test/build pass; test:data-export passes; existing
CSV exports unchanged.

STOP AND ASK if the existing CSV helper does not guard against formula
injection.
```

---

## After the last stage

Write `docs/crm-ai-implementation-report.md` in the structure of
`docs/patient-billing-implementation-report.md` (architecture, AI data flow,
security, verification table, full file manifest across all stages) and mark
the PRD §7 rows "Built".
