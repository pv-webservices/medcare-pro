# AI-1 writing assistant safety hardening

## Root cause and architecture

Baseline: latest fetched `main`, `949375913252abae4b26ff699459be23ee03a530`. Work is isolated on `codex/clinical-ai-writing-assistant-safety`; the original AI-2 hotfix workspace and its local changes are untouched.

Before: the provider supplied `changed`, `suggestedText`, and required suggestion annotations. The service required at least one annotation, HIGH confidence, matching categories and fragments, and independent fragment validation. A safe candidate could fail because of annotation formatting or confidence. Separately, the narrative validator accepted arbitrary one-character substitutions, including clinically meaningful changes such as `had → has`.

After: Gemini supplies a bounded, nonblank candidate string. MedCare computes a grapheme-aware enclosing diff, checks the complete candidate through ordered Unicode tokens, protected anchors and field policy, then creates the public review response locally. Provider confidence, categories, fragments and `changed` do not participate in safety decisions. The existing strict public response schema remains intact. Invalid JSON, missing/nonstring/blank candidates, unsuccessful provider envelopes, timeout and transport failures remain fail-closed.

The doctor still explicitly Accepts or Dismisses; only Accept updates the requesting local field, and existing Save persists it. The existing stale-source guard remains intact. No UI behavior or clinical persistence code was changed.

## Files changed

| File | Purpose |
| --- | --- |
| `src/lib/clinical-ai/writingSchemas.ts` | Separate minimal provider candidate schema from strict UI response. |
| `src/lib/clinical-ai/writingAssistant.ts` | Candidate-only prompt, local diff/validation and annotations; preserve post-provider entitlement errors. |
| `src/lib/clinical-ai/writingSafety.ts` | Deterministic Unicode diff, explicit correction rules, exact anchors, contextual punctuation/case protection and edit limits. |
| `tests/unit/clinicalWritingService.test.ts` | Metadata-independence, malformed candidates, HIGH-confidence unsafe controls, entitlement revocation and privacy regressions. |
| `tests/unit/clinicalWritingSafety.test.ts` | Safe/unsafe acceptance matrix, diff reconstruction, reason codes, Unicode, punctuation, unit case and field policies. |
| `tests/e2e/clinical-ai-provider-mock.cjs` | Safe browser fixtures return candidate-only output; unsafe dose fixture retains HIGH confidence to prove it cannot override validation. |
| `docs/clinical-ai-writing-assistant.md` | Document current provider contract, deterministic authority, field policies and conservative limits. |
| `docs/clinical-ai-writing-safety-hardening-report.md` | This implementation and verification report. |

## Safety behavior

- MEDIUM: `chiefComplaint`, `historyOfPresentIllness`. Explicit reviewed spelling corrections, including `diabates → diabetes`; same-tense patient/he/she agreement; narrow article edits and proven formatting.
- VERY_HIGH: `pastMedicalHistory`, `examinationFindings`, `investigationNotes`, `diagnosis`, `advice`, `followUpInstructions`. Smaller reviewed spelling set and existing patient agreement/article rules. Narrative diabetes correction and he/she agreement remain withheld.
- All other words remain exact. No general edit-distance acceptance, synonyms, clinical term replacement, content insertion/deletion/reordering, tense changes or preposition equivalence. Unknown corrections fail closed.
- Numeric values and representations, number words, dates, dose/unit bindings, routes, frequency, duration, negation, laterality, uncertainty, diagnosis and allergy content remain protected through ordered comparison. Unknown symbols and contractions are retained rather than discarded.
- Medication-like content freezes lexical changes. `sever → severe` requires a reviewed symptom immediately afterward, preventing `sever nerve → severe nerve`.
- Case-only changes are limited to the first letter of sentence-initial patient/the/he/she. This protects both ordinary and mixed-case units: `nM/nm`, `μM/μm`, `ms/Ms`, `mmol/Mmol`, and `pH/PH`.
- General comma edits are rejected: they can alter negation, allergy or test-result scope. Only the explicit positive patient-reports fever/cough/headache list permits comma formatting. Internal sentence boundaries, line breaks and other punctuation remain anchors; a terminal period/exclamation is surface formatting.
- Two lexical edits are allowed for short input. Longer input is capped at 20%/eight edits for MEDIUM or 10%/four edits for VERY_HIGH; clinical content is never permitted merely because it fits that budget.
- Internal non-PHI codes include NO_CHANGE, SAFE_SURFACE_EDIT, NUMBER_CHANGED, UNIT_CHANGED, NEGATION_CHANGED, LATERALITY_CHANGED, UNCERTAINTY_CHANGED, PROTECTED_ANCHOR_CHANGED, CLINICAL_FACT_ADDED/REMOVED, EDIT_TOO_LARGE and FIELD_POLICY_REJECTED. Persisted usage statuses retain their existing contract.

## Verification

Only synthetic data was used. Database-backed checks use a newly created localhost database, `medcare_ep_ai1_safety_20260922`. No production DB or environment was accessed or modified.

| Command/check | Result |
| --- | --- |
| Baseline writing safety + service suites | 152 passed (130 safety, 22 service). |
| RED metadata regressions | 8 failed / 30 passed, before service changes. |
| RED expanded safety matrix | 12 failed / 159 passed, before validator changes. |
| `npm test -- --maxWorkers=1` (`NODE_OPTIONS=--max-old-space-size=768`) | 168 files / 2,724 tests passed; 0 failed. |
| `npm run test:clinical-ai` | 32 database integration checks passed. |
| `npm run verify:prescriptions` | 9 checks passed. |
| `npm run test:prescriptions` | 58 database checks passed. |
| `npm run typecheck` | Passed; the final build also completed TypeScript checking. |
| `npm run lint` | 0 errors; 5 pre-existing warnings. |
| `npm run build` (`CIRCLE_NODE_TOTAL=2`) | Passed: Prisma generation, disposable-DB migration check, Next production build/TypeScript/static generation, runtime packaging. |
| `npm run test:e2e:clinical-ai` | 8 passed / 0 failed against the final production build, with mocked Gemini and synthetic fixtures. |
| `git diff --check` | Passed. |
| `graphify update .` | Final AST-only update completed; 6,087 nodes / 20,515 edges. Initial extraction reported an unavailable SQL parser and a pre-existing parser warning in `verify-stage3-registration.mts`. No LLM/API cost. |

An initial full unit attempt exhausted local memory; the sequential bounded run above passed. An initial build rejected an external `node_modules` junction; dependencies were then installed directly from the unchanged lockfile. Local test services required restarting after interruption; the completed integration results above are successful runs. An additional regression proved an empty fragment for a leading insertion; the local diff now includes adjacent unchanged context and reconstructs the candidate exactly. Independent review confirmed all 10 reproduced punctuation/unit-case attacks reject under all 8 field policies (80 assertions). No required review finding remains.

Existing lint warnings: unused declarations in `verify-stage11-audit.mts`, `ClinicDetail.tsx`, `RegistrationsTable.tsx`, and two in `appointmentStatusVocabulary.test.ts`. The unchanged lockfile reports six npm advisories: two moderate/four high across `@prisma/config`, `@vitest/mocker`, `deepmerge-ts`, `js-yaml`, `prisma`, `vitest`. Dependency remediation is separate scope.

Build warnings are the existing middleware-to-proxy convention warning and Tailwind config module-type warning. Browser logs include a NO_COLOR/FORCE_COLOR conflict warning. No test was deleted or disabled to obtain a pass; the obsolete expectation that MEDIUM confidence must reject was changed to the required metadata-independent contract.

## Live Gemini acceptance

The already configured credential was loaded only into a local synthetic provider harness. No key or raw provider payload was printed, persisted in application logs, or committed. The harness used the actual service prompt, candidate schema, Gemini adapter and deterministic validator; it did not mutate clinical records.

- Three repetitions each of `Patient has diabates.`, `Patient has fevr.`, `The paitent is stable.`, and `Patient are stable.`: **12/12 exact expected corrections returned and accepted**.
- Dose/frequency, negation, laterality and uncertainty controls: **4/4 unchanged**.
- Numeric and prompt-injection live controls: **2 QUOTA failures**, no candidate accepted; these checks are incomplete, not passes. No automatic retries were performed.
- Observed unsafe acceptance: **0**. Unchanged live controls do not prove rejection of a malicious candidate; the independent mocked matrix supplies that evidence.

## Database, security and limitations

**No database migration required.** Existing migrations were applied only to the disposable database to enable integration/build verification. Prisma schema and production data are unchanged.

Server-derived tenant/clinic ownership, authenticated actor, assigned linked Doctor, draft authority, `clinical_ai`, `clinical-ai:writing`, feature configuration, durable rate reservations and post-provider reauthorization remain enforced. No browser tenant/clinic identifiers are trusted. Logging remains metadata-only; no source/candidate/prompt/reason is added to application logs. No medication AI, auto-application, AI-2 changes, production deployment, Hostinger action or merge is included. No secrets are committed.

This intentionally favors false rejection: the explicit English spelling/grammar vocabulary is small, high-risk fields remain more restrictive, and general capitalization/punctuation editing is withheld. Unicode is preserved, but this is not a multilingual grammar engine or a proof of semantic equivalence. All accepted suggestions still require clinician review. Two live controls need completion after provider quota permits. Production runtime behavior and clinician pilot acceptance are not established by local tests.

## Production status

**PASS — AI-1 implementation is ready for controlled production validation.** This is not a production-complete claim. No production deployment or merge performed. Complete the two quota-limited synthetic provider controls and clinician pilot acceptance during controlled validation.
