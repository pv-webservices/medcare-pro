# Feature removal — Coding-agent handoff prompts (RM-1 → RM-4)

Written against `main` @ `dd1c3f4` (4 Nov 2026). Owner decisions (4 Nov 2026):

| # | Decision |
|---|---|
| R1 | Remove **voice transcript** (recording, upload, transcription, transcripts, speakers, corrections), plus the stages that only work on transcripts: **structured facts** and **prescription reconciliation**. |
| R2 | Remove the **spelling/writing assistant** (AI-1). With R1 this retires the whole `clinical_ai` feature and the shared AI provider in `src/lib/ai`. |
| R3 | Remove **pre-issue prescription checks** (AI-5). They were off (`PRESCRIPTION_CHECKS_ENABLED=false`), never clinician-approved, and import reconciliation code. |
| R4 | Remove the **adjustable dashboard** (personal layouts and role defaults). The dashboard stays, with a fixed widget order. |
| R5 | **Two-phase removal.** RM-1 and RM-2 remove code only and leave tables in place, unused. RM-3 drops tables and deletes stored audio only after a verified backup. |
| R6 | **GMB** was never built in the repo. Its PRD files are removed from the claude.ai Project; nothing to do in code. |
| R7 | (6 Nov 2026) The project is no longer hosted, so no live database holds retired keys or stored audio. **RM-4** removes the one-off RM-3 clean-up scripts and the retired-permission compatibility code they made temporary. |

**Do not touch:** prescriptions/consultations (`ClinicalConsultation`, prescription issue/print), billing, registrations, appointments, Tasks, IVR/Plivo, WhatsApp, patient portal, Revenue/Collections reports.

Order: RM-1 and RM-2 are independent (either first), one branch/PR each. Deploy both. RM-3 only after both are live and the backup in RM-3 step 1 exists. RM-4 only after RM-3 is merged, and only while no old database is due to be restored (see its STOP AND ASK).

---

## Shared rules (paste into every prompt)

```
GROUND RULES — read before changing anything
1. Read CLAUDE.md, AGENTS.md and docs/PRD.md in full. This is a REMOVAL task:
   delete only what this stage names. Do not refactor, rename or "tidy" anything
   else, even if it looks related.
2. No new npm dependencies.
3. Before deleting a file, grep for every import of it. A kept file that imports
   a removed one is edited minimally so it no longer does; list every such edit
   in the PR description.
4. Kept behaviour must be identical. Prescriptions draft/issue/print, billing,
   registrations, appointments, Tasks, IVR and reports must behave exactly as
   before (minus the removed panels/buttons). No existing test of a kept module
   may be changed to pass, except to delete assertions about removed UI.
5. RM-1 and RM-2: do NOT edit prisma/schema.prisma models, and do NOT create a
   migration. Tables stay in the database, unused, until RM-3. Run
   `prisma migrate diff` (schema vs migrations) and confirm it is empty.
6. Domain language: "Registration/visit", never "Appointment", for the visit.
7. STOP AND ASK (do not guess) if: a kept module needs a removed file for
   something other than the removed feature; removing a permission or feature
   key from the catalogue would make an existing role, plan or settings screen
   error on rows still in the database; a prescription already issued renders
   differently; or anything would require a migration in RM-1/RM-2.
8. Finish with: npm run typecheck, npm run lint, npm test, npm run build, and
   the stage's own checks. Report a file manifest (deleted / modified) and test
   results in the PR description. Do not deploy and do not run remote
   migrations or any script with --apply against a remote database.
```

---

## RM-1: Remove clinical AI (voice transcript, writing assistant, facts, reconciliation, pre-issue checks) — code only

```
TASK: MedCare Pro — RM-1 remove the clinical AI stack (code only). Branch: chore/rm-1-clinical-ai

[Paste GROUND RULES above]

CONTEXT
The owner has decided to remove the clinical AI features. This stage deletes
the code paths and leaves every database table in place. RM-3 drops the tables
later. Verify you are on main @ dd1c3f4 or later and that the files below exist;
if the tree differs, STOP and report.

DELETE (whole directories/files)
- src/lib/clinical-ai/, src/lib/clinical-audio/, src/lib/clinical-facts/,
  src/lib/clinical-reconciliation/, src/lib/transcription/,
  src/lib/prescription-checks/, src/lib/ai/
- src/components/clinicalAudio/
- src/components/prescriptions/ClinicalWritingControl.tsx,
  ReconciliationPanel.tsx, PreIssueChecksPanel.tsx
- src/components/settings/ClinicalAiSettings.tsx
- src/app/api/clinical-ai/ (all routes, incl. the Sarvam webhook)
- src/app/api/internal/clinical-audio/ (worker, cleanup, health cron routes)
- src/app/api/settings/clinical-ai/
- src/app/api/prescriptions/[id]/pre-issue-checks/
- any settings page that only hosts ClinicalAiSettings (find it via
  settingsSections.ts) and its settingsSections entry
- scripts: clinical-ai-test-fixture.ts, backfill-clinical-ai.mts,
  test-clinical-ai.mts, clinical-audio-*.mts/.ts, test-clinical-audio.mts,
  test-clinical-facts.mts, test-clinical-transcription.mts,
  verify-clinical-audio.mts
- tests: tests/e2e/clinical-ai.spec.ts, clinical-audio.spec.ts,
  clinical-transcription.spec.ts, run-transcription-worker.mts, and the unit
  tests for removed code (clinicalAudio*, clinicalFactsRoutes, clinicalWriting*,
  effectiveTranscript, factEvidence, factFailureCode, gemini*, preIssueChecks,
  reconcile*, reconciliation*, romanization, sarvam*). Confirm each by grep
  before deleting.
- playwright.clinical-ai.config.ts, playwright.clinical-audio.config.ts
- package.json scripts: clinical-ai:backfill, test:clinical-ai,
  test:e2e:clinical-ai, verify:clinical-audio, test:clinical-audio,
  test:e2e:clinical-audio, clinical-audio:* (all), test:clinical-transcription,
  test:clinical-facts
- docs: clinical-ai-*.md, clinical-audio-*.md, clinical-ai2a3-production-runbook.md,
  docs/qa/2026-09-ai2a2-live-sarvam.md (git history keeps them). Leave
  docs/releases/ untouched.
- .github/workflows/ci.yml: the whole "Run Clinical AI and transcription
  database tests" step (and its comment). It calls scripts this stage deletes,
  so CI fails if it stays. Remove any other CI step that runs a removed script.
- Leave the `.private_clinical_audio/` line in .gitignore until RM-3 has purged
  local audio.

EDIT (minimal, kept files)
1. src/components/prescriptions/ConsultationWorkspace.tsx: remove the writing
   control, audio panel and reconciliation panel and their props. The form,
   save, review and issue flow must be unchanged otherwise.
2. src/app/(dashboard)/registration/[id]/consultation/page.tsx: remove
   mayUseWritingAssistant, getClinicalAudioConfig, mayUseReconciliation and
   prescriptionChecksEnabled and the props they fed.
3. src/app/(dashboard)/registration/[id]/page.tsx and
   src/app/(dashboard)/prescriptions/[id]/page.tsx: remove mayViewClinicalAudio
   and any recording/transcript section.
4. src/lib/prescriptions.ts: remove runPreIssueChecks, getPreIssueChecks and the
   checks branch inside issue (checks, checksUnavailable, acknowledgedChecks).
   Issuing must work exactly as it did with PRESCRIPTION_CHECKS_ENABLED=false.
   If the issue input schema has an `acknowledgedChecks` field, keep accepting
   and ignoring it (so an open browser tab does not 400), and say so in the PR.
5. PrescriptionDocument.tsx / prescriptionValidation.ts: remove only references
   to removed modules. A prescription issued before this change must print
   byte-identically (compare the rendered HTML of one fixture before/after).
6. src/lib/apiHandler.ts: remove ClinicalAudioDisabledError/RecordingStateError
   mapping.
7. Catalogue: remove `clinical_ai` from src/lib/defaultFeatures.ts and
   src/lib/moduleFeatures.ts; remove every `clinical-ai:*` key from
   src/lib/permissions.ts and src/lib/defaultRoles.ts; remove clinical AI audit
   actions from audit.ts/auditDescriptions.ts ONLY if no stored audit row needs
   them to render (if old audit rows would show a raw key or crash, keep the
   description entries and say so); clean featureInstallation.ts and
   signup/route.ts references.
   Then check how the app treats feature rows and role permission strings that
   are still in the database but no longer in the catalogue (Settings →
   Features, Roles editor, "catalogue features missing from this database").
   They must be ignored or hidden, never an error. If not, STOP AND ASK.
8. .env.example: remove AI_*, GEMINI_*, CLINICAL_*, TRANSCRIPTION_*, SARVAM_*,
   PRESCRIPTION_CHECKS_ENABLED and the cron-secret lines for clinical audio.
   Keep R2 variables if anything else uses them; grep first.
9. scripts/test-prescriptions.mts: remove only the clinical AI cases.
9a. docs/PRD.md: in §6.10 replace FR-10.1–FR-10.5 with one line: "Clinical AI
    (writing assistant, recording/transcription, facts, reconciliation,
    pre-issue checks) removed in RM-1, Nov 2026; tables dropped in RM-3."
    Mark the matching §7 rows "Retired (RM-1), dropped in RM-3". Remove
    references to removed docs from README.md and docs/PROJECT_STRUCTURE.md.
10. Do NOT remove @aws-sdk/* from package.json yet (RM-3 uses it to purge
    audio). Note in the PR that it is now used only by RM-3.

ACCEPTANCE
- grep -rnE "clinical-ai|clinical-audio|clinical-facts|reconcil|transcri|
  prescription-checks|writingAssist|PreIssue|lib/ai/" src scripts tests
  returns nothing except deprecated Prisma model names in generated types.
- typecheck, lint, npm test, npm run build pass; test:prescriptions,
  test:billing and test:e2e:prescriptions pass.
- prisma migrate diff shows no change.
- A doctor can open a registration, write the consultation, issue and print a
  prescription with no AI panels and no console errors.
- CI passes on the PR with the clinical AI step removed.
- PR description includes this owner deploy checklist:
  1. Before deploying: delete the Hostinger cron jobs (or external scheduler
     entries) that call /api/internal/clinical-audio/worker, /cleanup and
     /health, and stop any `clinical-audio:worker` process.
  2. Remove the Sarvam webhook URL from the Sarvam dashboard and revoke the
     Sarvam and Gemini API keys.
  3. After deploying: delete the removed env vars (AI_*, GEMINI_*, CLINICAL_*,
     TRANSCRIPTION_*, SARVAM_*, PRESCRIPTION_CHECKS_ENABLED, clinical-audio
     cron secret) from Hostinger. Keep R2 credentials until RM-3's purge.

STOP AND ASK if any kept page imports a removed file for a reason other than
the removed feature, or if issued-prescription print output changes.
```

---

## RM-2: Remove the adjustable dashboard — code only

```
TASK: MedCare Pro — RM-2 remove dashboard customisation (code only). Branch: chore/rm-2-dashboard-layouts

[Paste GROUND RULES above]

CONTEXT
Users and admins can currently reorder, resize, show and hide dashboard widgets
(personal layouts and role defaults, stored in dashboard_layouts). The owner
wants one fixed dashboard. Each user still sees only the widgets their
permissions allow. The table stays until RM-3.

DELETE
- src/components/dashboard/DashboardLayoutEditor.tsx
- src/components/settings/DashboardSettingsClient.tsx
- src/app/(dashboard)/settings/dashboard/ and its settingsSections.ts entry
- src/app/api/dashboard/layout/ (incl. roles/[roleId])
- src/lib/dashboardLayouts.ts, src/lib/dashboardLayoutAuthority.ts
- unit tests and verify-script cases that only cover layouts
- `dashboard:customize` and `dashboard:layout:manage` from permissions.ts and
  defaultRoles.ts (same database-rows check as RM-1 step 7)
- layout audit actions, same rule as RM-1 step 7
- docs/PRD.md: drop the dashboard-customisation requirement and mark the
  `dashboard_layouts` §7 row "Retired (RM-2), dropped in RM-3"

KEEP AND SIMPLIFY
- src/lib/dashboardWidgets.ts stays as the single source of widget
  definitions and permission filtering (visibleDashboardWidgetIds).
- src/lib/dashboardWidgetOrder.ts: keep only what defines the fixed default
  order; delete the merge-with-saved-layout logic.
- src/app/(dashboard)/dashboard/page.tsx and AdminDashboard.tsx: render
  visibleDashboardWidgetIds in the default order and default sizes. Remove the
  "Customize" button, edit mode and any layout props.
- The default order and sizes must be exactly what a user with no saved
  layout sees on main today. Compare screenshots for Owner, Clinic Admin and
  Staff at desktop and mobile widths.

ACCEPTANCE
- grep -rnE "DashboardLayout|dashboardLayout|dashboard:customize|
  dashboard:layout" src tests scripts returns nothing except deprecated Prisma
  types.
- typecheck, lint, npm test, npm run build, verify:dashboard pass.
- prisma migrate diff shows no change.
- Owner/Admin/Staff dashboards show the same widgets as before for a user who
  never customised; a user who had a saved custom layout now sees the default.

STOP AND ASK if any widget's visibility depended on layout data rather than
permissions.
```

---

## RM-3: Drop the retired tables and purge stored audio (run only after RM-1 and RM-2 are live)

```
TASK: MedCare Pro — RM-3 drop retired tables, purge audio, clean catalogue rows. Branch: chore/rm-3-drop-retired-tables

[Paste GROUND RULES above, EXCEPT rule 5: this stage does edit the schema and
create a migration]

CONTEXT
RM-1 and RM-2 are merged and deployed. Verify both on main (grep from their
acceptance sections must be clean). If either is missing, STOP.

OWNER STEP BEFORE MERGING (agent writes the instructions, does not run them)
1. Full mysqldump of production taken and stored off-server.
2. Optional archive: a read-only export of the tables below to JSON/CSV if the
   client must retain clinical records. Ask the owner whether any recordings or
   transcripts fall under a retention obligation before purging. If yes, STOP
   until they answer.

DO
1. scripts/purge-clinical-audio.mts: lists every stored audio object key from
   consultation_recordings (and any derived/temporary keys the old storage code
   wrote — check git history of src/lib/clinical-audio/storage*.ts at dd1c3f4),
   prints count and total bytes, and with --apply deletes them from R2 using
   @aws-sdk/client-s3. Dry run by default, --allow-remote required for a
   non-local DATABASE_URL, idempotent, logs no patient data. Also deletes local
   files if the local storage driver was ever used.
2. scripts/clean-retired-catalogue.mts (dry run default, --apply,
   --allow-remote): removes the `clinical_ai` feature row and its plan links,
   and strips `clinical-ai:*`, `dashboard:customize` and
   `dashboard:layout:manage` from stored role permission arrays. Print every
   role it would change. Modelled on scripts/backfill-billing.mts.
3. prisma/schema.prisma: remove models AiRun, ConsultationRecordingConsent,
   ConsultationRecording, ConsultationRecordingEvent, TranscriptionRun,
   ClinicalTranscript, TranscriptReview, ClinicalTranscriptSegment,
   TranscriptDerivedView, TranscriptDerivedSegment, TranscriptSpeakerMapping,
   TranscriptCorrection, ClinicalFactExtractionRun, ClinicalFactCandidate,
   ClinicalFactEvidence, ClinicalFactReview, DashboardLayout; their enums
   (RecordingConsentMethod, RecordingConsenterType,
   ConsultationRecordingStatus, ConsultationRecordingEventType,
   TranscriptionProvider, TranscriptionRunStatus, TranscriptionMode, and any
   other enum only they use); every back-relation on kept models; and the
   column Tenant.allowGeminiTranscriptionFallback. Keep ClinicalConsultation
   and ConsultationMode.
4. Migration prisma/migrations/<timestamp>_drop_clinical_ai_and_dashboard_layouts/
   migration.sql via `prisma migrate dev --create-only` on a DISPOSABLE local
   DB, reviewed by hand. It must only DROP the tables above (children before
   parents), drop FKs pointing at them, and drop the one Tenant column.
   Nothing else. Paste the full SQL in the PR description.
   Triggers: the AI-2/AI-3 migrations created MySQL triggers (e.g. on
   transcript_reviews and clinical_fact_extraction_runs). Prisma does not
   generate trigger drops. List every CREATE TRIGGER in the migrations folder;
   add an explicit `DROP TRIGGER IF EXISTS` for each one on a dropped table, and
   STOP AND ASK if any trigger sits on a kept table but references a dropped one.
   Do the same for any stored procedure or function those migrations created.
4a. Remove the `.private_clinical_audio/` line from .gitignore after the purge
    script has removed local audio.
5. After the purge script is no longer needed in CI, remove @aws-sdk/client-s3
   and @aws-sdk/s3-request-presigner ONLY if grep shows no other use. Otherwise
   keep them and say why.
6. docs/PRD.md: remove the §7 rows marked "Retired" by RM-1/RM-2 and add one
   line to §10: "Clinical AI and dashboard customisation were removed in Nov
   2026 (RM-1..RM-3); their tables were dropped after a backup."
7. Remove the deprecated-model comments RM-1/RM-2 may have left, and any
   generated Prisma types still referencing removed models.

ROLLOUT ORDER (put in the PR description)
1. Backup (owner).  2. purge-clinical-audio dry run → review → --apply.
3. clean-retired-catalogue dry run → review → --apply.
4. Deploy and run `prisma migrate deploy`.  5. Remove the deleted env vars from
Hostinger.  6. Smoke test: login, registration, consultation, prescription
issue/print, billing, dashboard for Owner and Staff.

ACCEPTANCE
- prisma format/validate/generate pass; `npm run build` from an empty local DB
  applies all migrations; on a local copy seeded with old data, the new
  migration applies cleanly after both scripts ran.
- typecheck, lint, npm test and the kept modules' DB tests pass.
- grep for every removed model name returns nothing.

STOP AND ASK if any kept table has a foreign key to a table being dropped that
is not listed here, or if the owner has not confirmed the backup.
```

---

## RM-4: Remove the RM-3 clean-up scripts and the retired-permission compatibility code (run only after RM-3 is merged)

```
TASK: MedCare Pro — RM-4 retire the RM-3 one-off tooling and retired-key compatibility. Branch: chore/rm-4-retire-cleanup-tooling

[Paste GROUND RULES above. Rule 5 does not apply: RM-4 needs no schema change
and no migration — do not create one. Rule 8's `npm run build` runs
`prisma migrate deploy`, so point DATABASE_URL at an empty disposable local
database only.]

CONTEXT
RM-1 retired the clinical-ai:* permission keys and RM-2 retired
dashboard:customize and dashboard:layout:manage. Because the Roles editor sends
a role's whole stored permission list back on save, RM-1/RM-2 kept those keys
"known but granting nothing" so old roles stayed saveable, and RM-3 added
scripts/clean-retired-catalogue.mts to strip them from stored roles and
scripts/purge-clinical-audio.mts to delete stored audio. The code says this
compatibility "can go once that has run in production". The project is no
longer hosted (owner decision R7), so RM-4 removes it.

PRECONDITION — verify on main before changing anything, STOP if any fails
- prisma/migrations/20261104202151_drop_clinical_ai_and_dashboard_layouts exists.
- tests/unit/rm3DropMigration.test.ts passes.
- No model for any table RM-3 dropped is in prisma/schema.prisma.

DO
1. src/lib/permissions.ts: delete RETIRED_PERMISSIONS, RETIRED_PERMISSION_KEYS
   and withoutRetiredPermissions(), with their doc comments, and drop the
   RETIRED_PERMISSION_KEYS clause from isKnownPermission(). Do not touch
   LEGACY_PERMISSION_ALIASES or LEGACY_PERMISSION_KEYS (live dashboard
   vocabulary aliases, not retired keys).
2. src/lib/roles.ts: permissionListSchema keeps .max(ALL_PERMISSIONS.length)
   and the de-duplication, drops the withoutRetiredPermissions transform and
   its comments. A retired key on save must now fail the existing
   "Unknown permission" check in the role write path (the isKnownPermission
   filter in src/lib/roles.ts) exactly like any other unknown key — do not add
   a special message for it.
3. src/lib/roleAuthority.ts: evaluateRoleGrantAuthority uses
   options.actorPermissions and options.targetPermissions directly; delete the
   retired-key filtering and its comment.
4. src/lib/defaultRoles.ts: PRE_DOCTOR_SELF_ROLE_PERMISSIONS is a FROZEN
   historical snapshot used to recognise old stored roles. Keep its output
   byte-identical: replace the RETIRED_PERMISSIONS argument with the literal
   ["dashboard:customize", "dashboard:layout:manage"] and drop the import.
   Prove it with a unit assertion of the exact array before and after.
5. Delete scripts/purge-clinical-audio.mts and
   scripts/clean-retired-catalogue.mts (grep first: no package.json script or
   CI step references them today).
6. Remove @aws-sdk/client-s3 from package.json and package-lock.json
   (`npm uninstall @aws-sdk/client-s3`) after grep shows no other import.
   This is the only dependency change allowed.
7. .env.example: delete the "Retired consultation-recording storage" block
   (its comment and the RECORDING_* lines).
8. Delete the stray committed files AGENTS.md.tmp and CLAUDE.md.tmp at the
   repo root.
9. Tests:
   - tests/unit/retiredPermissions.test.ts: replace with checks that each of the
     eight retired keys is NOT known (isKnownPermission false), is not in
     ALL_PERMISSIONS, PERMISSION_GROUPS or any DEFAULT_ROLES entry, and that
     a role create/update carrying one is REJECTED with "Unknown permission"
     by the role write path; and that a role holding only current keys still
     saves. roleMutationSchema itself only parses (max length, de-duplication).
   - tests/unit/billingFoundation.test.ts line ~128: express the expected
     DEFAULT_ROLES permissions without the deleted helpers (filter the literal
     retired keys inline). The assertion must keep checking the same thing.
   - Any other test importing a deleted export: edit minimally, list it in the
     PR.
10. docs/PRD.md §10: change "(RM-1..RM-3)" to "(RM-1..RM-4)" and append
    "; RM-4 removed the one-off clean-up scripts." Nothing else in the PRD.

DO NOT TOUCH
- Historical role snapshots: src/lib/preBillingRoles.json, the
  dashboard:customize literals in src/lib/doctorSelfRoleMigration.ts, and every
  other PRE_* constant. They identify roles created before earlier upgrades.
- Any file under prisma/migrations/, including the RM-3 migration's SQL
  comment that names clean-retired-catalogue.mts (migrations are checksummed).
- tests/unit/rm3DropMigration.test.ts.
- The RM-1..RM-3 sections of this file and docs/releases/* (history).
- Everything in the "Do not touch" line at the top of this file.

ACCEPTANCE
- grep -rnE "RETIRED_PERMISSIONS|RETIRED_PERMISSION_KEYS|withoutRetiredPermissions|purge-clinical-audio|clean-retired-catalogue|@aws-sdk|RECORDING_S3" \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git .
  returns only: prisma/migrations/** and docs/feature-removal-handoff-prompts.md
  (plus tsconfig.tsbuildinfo if present, which is generated).
- clinical-ai: and dashboard:customize / dashboard:layout:manage appear only in
  historical snapshots, migrations, tests asserting rejection, and docs.
- PRE_DOCTOR_SELF_ROLE_PERMISSIONS is unchanged (asserted by a test).
- npx prisma validate passes; `prisma migrate diff` (migrations vs schema) is
  empty; no new migration folder.
- npm run typecheck, npm run lint (no new errors), npm test pass.
- npm run build against an EMPTY disposable local DB applies all migrations.
- Manual: on that local DB, sign up, open Settings → Roles as Owner, edit and
  save a system role and a custom role; assign a role to a Staff user. All
  succeed.

STOP AND ASK if
- an old production database, or a backup of one, will ever be restored or
  imported. Both clean-up scripts must run on it (dry run, review, --apply)
  BEFORE RM-4 merges, because they will not exist afterwards and saving any
  role that still holds a retired key would then fail.
- any kept code needs a retired key for something other than recognising a
  historical snapshot.
- removing @aws-sdk/client-s3 breaks anything other than the deleted script.
```
