# Phase AI-1 implementation report

**Current AI-1.1 release: SPELLING/GRAMMAR only on all eight supported fields.** CONCISE/CLINICAL_WORDING are intentionally deferred because the conservative validator cannot establish broader rewrites as safe enough for release. Historical AI-1 verification below is retained; the AI-1.1 correction and current validation are recorded separately at the end.

Branch: `codex/clinical-ai-writing-assistant`. Fetched baseline: `origin/codex/electronic-prescriptions`, commit `ede921d940c180e0a5ff39718ee2e7dd2652bc9f`. Phase AI-1 implementation and safety hardening are finalized for independent review. No production deployment, remote database migration, real-patient provider request, paid call or AI-2 work was performed.

## A. Architecture implemented

The existing prescription/consultation architecture is preserved. The dynamic consultation page resolves eligibility; per-field controls request `/api/clinical-ai/writing-assist`; the writing service owns input, clinician/clinic/tenant authority, entitlement, reservation, prompt, response and safety validation. Provider selection and HTTP transport stay in the shared AI foundation. `AiProvider` is injectable for deterministic tests and future providers. Gemini uses configured model/key/timeout and schema-constrained JSON. Shared usage accepts metadata and counts, never note text.

Strict Zod validates client requests and provider responses. Ordered lexical/clinical anchors and restricted field modes reject obvious medical transformations independently of prompts. The service rechecks authority after provider waiting. The UI validates the public shape and requires explicit review, Accept/Dismiss and the existing Save action.

## B. Files added (24)

| File                                                              | Purpose                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/ai/types.ts`                                             | Reusable provider/request/result and numerical run-input interfaces |
| `src/lib/ai/config.ts`                                            | Fail-closed server configuration                                    |
| `src/lib/ai/errors.ts`                                            | Fixed, PHI-safe provider errors                                     |
| `src/lib/ai/provider.ts`                                          | Provider selection factory                                          |
| `src/lib/ai/providers/gemini.ts`                                  | Bounded server structured-JSON transport                            |
| `src/lib/ai/usage.ts`                                             | Durable rate reservations and metadata accounting/audit             |
| `src/lib/clinical-ai/writingSchemas.ts`                           | Strict schemas and central field policies                           |
| `src/lib/clinical-ai/writingSafety.ts`                            | Ordered medical anchors and reviewed equivalences                   |
| `src/lib/clinical-ai/writingAssistant.ts`                         | Authorized writing-only orchestration and eligibility               |
| `src/app/api/clinical-ai/writing-assist/route.ts`                 | Protected, byte-bounded, no-store endpoint                          |
| `src/components/prescriptions/ClinicalWritingControl.tsx`         | Per-field mode menu, review and stale acceptance guard              |
| `prisma/migrations/20260913120000_clinical_ai_runs/migration.sql` | Additive metadata table, indexes, restrictive foreign keys          |
| `scripts/backfill-clinical-ai.mts`                                | Dry-run/create-only disabled feature installer                      |
| `scripts/clinical-ai-test-fixture.ts`                             | Disposable synthetic clinic/doctor entitlement fixture              |
| `scripts/test-clinical-ai.mts`                                    | Real local DB checks with injected mock providers                   |
| `tests/unit/clinicalWritingSafety.test.ts`                        | Input, field, configuration and meaning tests                       |
| `tests/unit/clinicalWritingService.test.ts`                       | Service authority, safety, privacy and failure tests                |
| `tests/unit/clinicalWritingRoute.test.ts`                         | Public status, request bounds and PHI-safe errors                   |
| `tests/unit/geminiProvider.test.ts`                               | Mock transport parsing, limits and provider failures                |
| `playwright.clinical-ai.config.ts`                                | Guarded local browser server with mocked Gemini                     |
| `tests/e2e/clinical-ai-provider-mock.cjs`                         | Test-runner preload; no production import or bypass                 |
| `tests/e2e/clinical-ai.spec.ts`                                   | Actual endpoint/service browser flows                               |
| `docs/clinical-ai-writing-assistant.md`                           | Design, operations, QA, rollout and limitations                     |
| `docs/clinical-ai-writing-assistant-implementation-report.md`     | This complete change and validation report                          |

## C. Files modified (15)

| File                                                          | Why                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `.env.example`                                                | Disabled server-only AI placeholders; no model/key hardcoded           |
| `package.json`                                                | Feature installer, AI integration and AI E2E scripts                   |
| `prisma/schema.prisma`                                        | AiRun and owning inverse relationships                                 |
| `src/lib/defaultFeatures.ts`                                  | Disabled PREMIUM add-on excluded from Standard                         |
| `src/lib/moduleFeatures.ts`                                   | Authoritative `clinical_ai` module mapping                             |
| `src/lib/permissions.ts`                                      | Explicit writing permission; excludes it from historical stages        |
| `src/lib/defaultRoles.ts`                                     | New Doctor seeds; excludes AI from historical snapshots                |
| `src/lib/audit.ts`                                            | Metadata-only run-completion action                                    |
| `src/lib/auditDescriptions.ts`                                | Human-readable clinical audit description                              |
| `src/app/(dashboard)/registration/[id]/consultation/page.tsx` | Server eligibility prop without secrets                                |
| `src/components/prescriptions/ConsultationWorkspace.tsx`      | Subtle controls around existing supported textareas; local dirty state |
| `playwright.prescriptions.config.ts`                          | Explicit AI disablement for existing Rx browser regression             |
| `tests/unit/appointmentPermissionDefaults.test.ts`            | Historical-stage expectations account for excluded AI permission       |
| `tests/unit/auditDescriptions.test.ts`                        | Stage completeness recognizes the dedicated AI stage                   |
| `tests/unit/permissions.test.ts`                              | Allows the requested hyphenated resource namespace                     |

No prescription services, validation, medication builder, appointment domain, telephony or other unrelated modules were redesigned or replaced.

## D. Database changes

Only `ai_runs` is added. Four RESTRICT relationships: Tenant, Clinic, User, Registration. Three composite rolling-window indexes: tenant/created time, tenant/user/created time, tenant/registration/created time. Stored fields are IDs, feature/field/mode/provider/model/status, numerical character/token counts, latency and created time. There are no prompt/response/error/note/demographic columns. No clinical history deletion, rewriting or content backfill. The complete forward migration chain was applied only to disposable MariaDB 11.4 at `127.0.0.1:33331/medcare_ep_ai1` in container `medcare-ai1-validation-20260913`.

## E. Permissions

`clinical-ai:writing` is explicit, clinic-scoped and server-enforced in addition to prescription read/draft authority. New Doctor seeds receive it; existing custom/system roles are not migrated automatically. Receptionist/Staff defaults do not receive it. Admin catalogue/wildcard semantics are unchanged, but administrative authority alone cannot substitute for linked assigned Doctor identity.

## F. Feature entitlement

`clinical_ai` is PREMIUM, globally off by default and in no default plan. Platform feature controls manage the global switch, plan links and reasoned tenant overrides; tenant controls manage PREMIUM role access. All these layers are independent of the action permission. `AI_ENABLED=false` or invalid server configuration additionally hides controls and rejects requests. `clinical-ai:backfill` defaults to read-only review and can create only a missing disabled feature; it grants no plans, overrides or roles.

## G. Safety controls

Explicit clinician action; strict visit context; authoritative field/mode/length policies; medication builder excluded entirely; fixed language-only prompt; JSON schema plus strict response validation; ordered number/unit/medicine/diagnosis/date/frequency anchors; percentages, leading-dot decimals, inequalities, temporal auxiliaries, negation and question-mark uncertainty retained; no fuzzy drug/diagnosis matching; fragment containment and meaning checks; mode/category compatibility; fixed safe reasons; unsafe output withheld and no automatic retry; stale source comparison; no AI clinical writes; normal optimistic Save remains required; post-provider authorization recheck.

## H. Privacy controls

Only the target field text goes to the provider, never assembled patient demographics. No prompt, request body, response body, clinical text or raw provider/Prisma error logging is introduced. Shared usage receives counts and metadata only. Global audit records high-level request outcome metadata, not clinical content or keystrokes. Accept/Dismiss are local actions, not falsely server-audited writes. Both public success/errors use private/no-store headers and fixed PHI-safe errors. Existing PHI-safe Prisma settings remain unchanged. Automated tests use synthetic fixtures and mock transport only.

## I. Validation results

| Check                                                                    | Exact result                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                      | Passed                                                                                                                          |
| `npm run lint`                                                           | Passed, zero errors; five pre-existing unrelated warnings                                                                       |
| `npm test -- --maxWorkers=4`                                             | 154 files, 2,381 tests passed                                                                                                   |
| Final focused `vitest run clinicalWriting geminiProvider --maxWorkers=4` | Four files, 127 tests passed after final safety hardening                                                                       |
| `npm run test:clinical-ai`                                               | 32 real local DB integration checks passed; mock providers only                                                                 |
| `npm run test:prescriptions`                                             | All 58 real local DB checks passed                                                                                              |
| `npm run verify:prescriptions`                                           | All nine read-only checks passed                                                                                                |
| `npm run build`                                                          | Passed with verified disposable local DATABASE_URL and AI disabled; includes local forward migrations                           |
| `npm run test:e2e:clinical-ai`                                           | All six Chromium tests passed; actual endpoint/service with mocked Gemini transport                                             |
| `npm run test:e2e:prescriptions`                                         | All 26 existing Chromium tests passed, including mobile/tablet/desktop, lifecycle, print, security and registration regressions |
| Existing roles, registrations, Stage 8 and Stage 9 verification scripts  | All passed against disposable local DB                                                                                          |
| `git diff --check`                                                       | Passed                                                                                                                          |
| Feature installer dry-run                                                | Passed; no grants or role writes                                                                                                |

The full suite includes the new unit/service/route tests and existing clinical/security regressions. Provider tests cover success, invalid/truncated JSON/schema, auth/model/quota/network failures, body limits and timeout. DB checks cover foreign scope, identity, entitlement, disabled provider, PHI-free metadata, no automatic clinical writes, explicit existing Save persistence and concurrent rate reservation enforcement.

Existing build warnings: deprecated Next middleware convention and CommonJS/ES-module inference for Tailwind config. Existing lint warnings: stage-11 fixture variable, ClinicDetail buttonClasses import, RegistrationsTable visit-type import, and two appointment-status test imports. None is introduced by AI-1.

Environment recovery during validation: stale generated route types from another branch were moved outside the workspace; an empty installed Prisma package was restored from the exact locked 6.19.3 package without a lockfile/dependency change. A concurrent local DB check temporarily locked the Windows Prisma engine DLL; the build was rerun after DB processes finished. The test preload path was normalized to forward slashes for Node's Windows NODE_OPTIONS parser. Final results above supersede those interim failures.

## J. Environment variables

Validation evidence is retained in `C:/Users/hp/.codex/visualizations/2026/09/13/01a09b71-c848-7b83-8622-78e288d30efd`: final unit, lint, build and browser logs plus `writing-suggestion-desktop.png` and `writing-stale-mobile.png`. Both screenshots were visually inspected. The disposable container `medcare-ai1-validation-20260913` is stopped with synthetic fixtures retained; no production environment files were changed.

`AI_ENABLED`, `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`. Defaults are disabled, Gemini provider placeholder, empty key/model and 15,000 ms timeout. No browser/public-prefixed variables or credentials. Timeout accepts 1,000–30,000 ms; unsupported/missing provider/model/key configuration fails closed.

## K. Manual local QA and rollout

See the main design document's numbered local QA steps. Use a disposable localhost `medcare_ep*` DB and process-local DATABASE_URL, run local migrations/build, review/create the disabled feature, then enable only a synthetic clinician's tenant/role feature and writing/draft rights. Configure Gemini only for an approved synthetic manual provider test. Open the linked Doctor's synthetic visit, enter HPI, Improve → mode, verify original unchanged, Accept → verify unsaved local change, Save draft → reload, then test Dismiss and stale source edits. Verify restricted modes and no medication controls. Disable AI and restart; prescription editing must continue.

Rollout requires separately approved production schema/feature installation and privacy/provider review, then internal test accounts → demo clinic → controlled clinician pilot → reviewed AI add-on release. No rollout was performed. Instant rollback is AI_ENABLED=false/restart or the clinical_ai kill switch; retain additive usage metadata and existing prescription history.

## L. Known limitations and deferred work

Meaning checks are deliberately lexical/conservative, not proof of clinical equivalence. The small reviewed spelling map, preserved word order and limited agreement normalization may reject legitimate wording/concise rewrites. Review is always required. Notes above assistant limits remain editable/savable normally. Live provider/model-specific schema acceptance requires synthetic manual QA. There is no inline diff dependency, automatic retry, acceptance/dismissal endpoint, historical AI role backfill, invoice/billing engine or patient-facing AI. All Phase AI-2 and later capabilities remain absent.

## M. Final verification and hardening findings

The required initial Git checks confirmed branch `codex/clinical-ai-writing-assistant`, HEAD and merge-base `ede921d940c180e0a5ff39718ee2e7dd2652bc9f`, and an unchanged ten-commit baseline history. There were 15 modified and 24 added files, all within AI-1; all 39 report paths exist. Initial tracked diff: 122 insertions, 27 deletions. `git diff --check` passed with only Windows line-ending notices. No reset or discard occurred.

Issues found and corrected:

- Past medical history allowed all modes: restricted it to SPELLING/GRAMMAR. At that historical AI-1 stage, CONCISE/CLINICAL_WORDING remained on chief complaint and HPI; AI-1.1 subsequently removed them from every public field.
- Normal fields equated `from`/`for`, potentially changing cause/timing: removed that equivalence and added a causality regression.
- The requested anchor matrix had coverage gaps: added all specified dose, decimal, volume, tablet, frequency, interval, temperature, blood-pressure, oxygen, HbA1c, laterality, negation and diagnostic-certainty examples. `.5` → `0.5` is explicitly rejected. The reviewed `fevr` → `fever` spelling correction is supported; diagnostic substitutions and loss of uncertainty remain rejected.
- Strict-schema tests omitted several proxy overrides: added provider, model, prompt, system instruction and target URL cases plus a real-context generic-request rejection.
- Parallel rate tests isolated only user limits: added registration and tenant boundary races, each admitting exactly one of four simultaneous requests into its last available slot. Added an explicit clinical_ai global kill-switch DB check.
- Loading relied only on React state: added a synchronous in-flight guard against duplicate actions.
- Long unbroken suggestions widened the tablet page despite an initially passing control-local assertion: constrained the consultation fieldset/grid minimum widths, wrapped suggestion text, and strengthened E2E to assert page width at 390/768/1366 px. This is a narrow layout correction, not a consultation redesign.
- Empty fields displayed unnecessary disabled Improve controls: hide controls until meaningful input exists, retain pending/review/error state, and label Improve with the human-readable field name for accessibility.
- Browser coverage lacked tablet keyboard/long-text/failure cases: added them and strengthened stale acceptance to preserve the doctor's added headache/vomiting text.
- Production privacy guidance was too general: added the explicit unpaid/free Gemini patient-data prohibition, approved jurisdiction/customer processing requirement, stateless transport/retention distinction and future Vertex interface strategy. Added exact selected-role administration steps and metadata-only operational status semantics.

No browser provider calls, client secrets, direct AI consultation writes, medication AI controls, generic clinical payload logs or AiRun clinical-content columns were found. The built browser assets also contain no Gemini endpoint/key-header/config identifiers. Provider results pass strict schema, field/mode policy and full-text/fragment clinical safety checks before being returned; unsafe output is withheld without retry. Existing optimistic Save remains authoritative.

AiRun retains ownership identifiers and is therefore sensitive, linkable operational metadata, not anonymous data. Rate-denied requests have no AiRun reservation; HTTP status-only metrics can count them. RESTRICT relationships intentionally prevent hard-deleting referenced owners/visits; any eventual retention/purge policy needs a separately reviewed operational procedure. Provider-side logging, retention and compliance approval remain deployment responsibilities.

One interim prescription browser run timed out at the existing five-second post-issuance navigation assertion (25 passed, one failed). A read-only local DB check confirmed issuance succeeded; the complete unmodified-threshold rerun passed all 26 tests in 51.0 seconds. Final AI E2E passed six tests in 26.8 seconds, including the corrected page-level overflow checks. Final unit rerun passed 154 files/2,381 tests. No application or test-threshold change was made for the transient navigation failure.

## N. Phase AI-1.1 — Functional calibration

Reviewed starting HEAD: `481d9cb0794b4cfae82396e82e47dddacce8a773`; initial worktree was clean on the existing `codex/clinical-ai-writing-assistant` branch. No new branch or PR was created.

Released UI/API modes and response categories are now **SPELLING and GRAMMAR only**. The same two modes apply to chiefComplaint, historyOfPresentIllness, pastMedicalHistory, examinationFindings, investigationNotes, diagnosis, advice and followUpInstructions. CONCISE/CLINICAL_WORDING are deliberately deferred because ordered lexical invariants cannot establish broader semantic rewriting as safe enough for release. The prompt forbids style/conciseness/tone/professional rephrasing; no-change copy accurately describes spelling/grammar.

Exact files modified:

- `src/lib/clinical-ai/writingSchemas.ts`: authoritative released modes and response categories.
- `src/lib/clinical-ai/writingAssistant.ts`: spelling/grammar-only instruction and category policy; authorization remains unchanged.
- `src/components/prescriptions/ClinicalWritingControl.tsx`: only two active options and corrected no-change copy.
- `src/components/prescriptions/ConsultationWorkspace.tsx`: accurate helper copy.
- `tests/unit/clinicalWritingSafety.test.ts`: every field's accepted/rejected modes, deferred categories, safe correction examples and ambiguous clinical spelling/preposition rejection.
- `tests/unit/clinicalWritingService.test.ts`: deferred modes rejected before provider/reservation, prompt and generated schema alignment.
- `tests/e2e/clinical-ai.spec.ts`: all eight menus expose only spelling/grammar; all sixteen field/deferred-mode API combinations return 400 without reservations; no-change text and original-note retention.
- `docs/clinical-ai-writing-assistant.md`: current field matrix, intentional deferral, manual synthetic QA matrix, A/B/C classification with C=0 release gate and future semantic-invariant note.
- `docs/clinical-ai-writing-assistant-implementation-report.md`: current calibration/report, preserving explicitly historical AI-1 results.

The safety validator and reviewed typo map are unchanged. No a/an expansion, preposition equivalence, fuzzy matching, synonyms, arbitrary token changes or second-LLM equivalence judge were introduced. Existing numeric/decimal/unit/medication, negation, uncertainty, laterality and temporal regressions remain passing. Medication controls remain absent. Source equality, Accept/Dismiss and explicit optimistic Save are unchanged. No authority, entitlement, provider transport/configuration, logging or database model/migration changes occurred; AiRun remains metadata-only.

### AI-1.1 final validation

| Command/check                                     | Result                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| npm run typecheck                                 | Passed                                                                     |
| npm run lint                                      | Passed; zero errors, five existing unrelated warnings                      |
| npm test -- --maxWorkers=4                        | 154 files, 2,405 tests passed                                              |
| Focused clinicalWriting/geminiProvider unit suite | Four files, 151 passed                                                     |
| npm run test:clinical-ai                          | 32 local DB checks passed                                                  |
| npm run verify:prescriptions                      | Nine checks passed                                                         |
| npm run test:prescriptions                        | 58 local DB checks passed                                                  |
| npm run build                                     | Passed; verified disposable localhost DB, AI disabled and Gemini key unset |
| npm run test:e2e:clinical-ai                      | Eight passed, including direct API mode rejection                          |
| npm run test:e2e:prescriptions                    | 26 passed                                                                  |
| git diff --check                                  | Passed                                                                     |

Provider calls remain mocked in all automated checks. Local build deployed no new migration. Validation evidence uses `ai11-*` logs in the existing external artifact directory. No screenshots, logs, secrets, DB files or generated artifacts entered the correction commit.

**Live Gemini QA: NOT RUN — no local provider credentials supplied.** The documented synthetic matrix is a manual approval gate; no live outcomes are claimed. Future structured facts/protected entities/fact reconciliation/source evidence remain deferred. No merge, deployment or AI-2 work was performed.
