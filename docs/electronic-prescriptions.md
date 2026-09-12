# Phase 1 — Electronic Prescription delivery

Implementation branch: `codex/electronic-prescriptions`. Base checkout: `c019bef`, verified equal to `origin/main` on 12 September 2026. Changes are local; no production deployment, database migration, permission apply, provider operation or outbound delivery was performed.

## Architecture and data model

Clinical records belong to an actual Registration/visit, not an Appointment. The existing conversion flow remains Appointment → Registration → ClinicalConsultation → Prescription → PrescriptionItem. Pages and route handlers call the clinical service; ownership and lifecycle decisions live on the server.

`ClinicalConsultation` carries tenant, clinic, visit, patient, assigned Doctor and creator references, explicit consultation mode, the eight clinical note fields, timestamps and DRAFT/FINALIZED status. A unique Registration reference enforces one encounter per visit.

`Prescription` carries the same visit-derived ownership, encounter reference, version, optimistic revision, lifecycle state, optional official number, issuance metadata, correction linkage, cancellation metadata, version-owned clinical notes and issuance snapshot. A nullable unique active-draft key enforces one draft per visit. Unique encounter/version and supersedes references prevent parallel correction branches. History indexes cover tenant/clinic/status/issued date, patient and Doctor lookups.

`PrescriptionItem` stores medication names, form, strength, dose, route, frequency, timing, duration, quantity, instructions and ordered position. The service replaces medication rows atomically only on editable drafts. Unique prescription/order positions prevent ambiguous ordering. Drafts may be incomplete; issuance requires a diagnosis, at least one medication and meaningful medication name, form, dose, route, frequency and duration.

Migration: `20260912120000_electronic_prescriptions`. It adds three clinical tables, their indexes and restrictive foreign keys, and three nullable Doctor columns. It does not reset, delete or backfill clinical records. All clinical owning foreign keys use RESTRICT, including Patient, Registration, Doctor, Clinic, Tenant and recorded actors. The migration was deployed against disposable local MariaDB using the project's full migration chain.

Doctor changes: `qualification`, `medicalRegistrationNumber`, `registrationCouncil`. Creation, partial editing, service projections, detail display and both form modes support them. Existing profiles and older API payloads remain valid. All three credentials are required only at clinical issuance. Portal identity remains the separate existing `Doctor.userId` link with its existing authorization rules.

Clinic identity reuses the existing name, address, city and logo configuration. Where available, the existing public clinic phone is read from clinic phone settings and frozen in the prescription; no duplicated branding/contact settings were added.

## Lifecycle and immutable history

An authorized preparer saves a DRAFT, including unfinished notes/medications. Each successful save increments its revision. A stale revision returns a conflict rather than overwriting another session's work.

Review saves and validates the draft, then displays the prescription layout clearly marked as unofficial. Issuance requires a separate explicit confirmation. The server locks the visit, reloads authoritative ownership, checks entitlement and clinical authority, validates the revision/content/credentials, generates a unique official number, freezes the snapshot, issues the Rx, finalizes the original encounter and appends an audit entry in one transaction.

Numbers use `RX-YYYY-` plus a complete uppercase UUID. They are globally unique rather than sequential, generated only on the server at issuance and protected by a database unique index. Number collision/deadlock retries restart the entire issuance transaction; neither patient numbering nor appointment booking is repurposed for this subsystem.

ISSUED, SUPERSEDED and CANCELLED documents have no content update/delete endpoint. Correction clones the original frozen notes and medications into a new DRAFT with version +1 and a supersedes reference. The original remains ISSUED while correction is pending. Issuing the corrected draft atomically marks the original SUPERSEDED and retains both documents and their numbers/snapshots. Correction notes never mutate the finalized original ClinicalConsultation.

Cancellation requires explicit `prescription:cancel`, a confirmation modal and a nonblank bounded reason. It retains the number, snapshot, issue metadata, actor and cancellation timestamp. Only a current issued Rx without a pending correction may be cancelled.

The frozen version-1 snapshot contains patient identity/contact, Doctor credentials, clinic branding/contact, visit context, clinical notes, ordered medications, number and issue instant. Historical detail and print render this snapshot. Later edits to live Patient, Doctor or Clinic profiles cannot rewrite issued content. Visit timestamps preserve the existing UTC-tagged clinic wall-clock convention; issue instants display in India time and issue-date filters use matching India day boundaries.

## Security and entitlement

New central permissions: `prescription:read`, `prescription:draft`, `prescription:issue`, `prescription:cancel`. The permission catalogue supplies the existing Roles & Permissions UI. New Doctor seeds receive read/draft/issue; receptionist/staff seeds receive no clinical Rx rights; Admin receives the explicit catalogue and Owner retains wildcard behavior.

Permission scope is resolved by the existing clinic RBAC helpers. Cross-tenant and out-of-clinic IDs return the same not-found semantics. Client bodies are strict Zod objects; tenant, clinic, patient, Doctor, number, status and snapshot fields cannot become authoritative browser inputs. Identity is derived from Registration relationships.

Read visibility is clinic-wide by explicitly granted `prescription:read`, matching the existing Registration read policy. It is not based on a role name. Draft preparation is possible for an explicitly authorized non-Doctor. Issuance and creation of clinical corrections additionally require the signed-in user to be the explicitly linked assigned Doctor of that Registration, in that clinic. Administrative permissions/wildcards cannot impersonate a clinician.

The `prescriptions` feature is CORE and belongs to the Standard plan because it is part of the clinical visit workflow. Entitlement remains separate from permission. Global switch, plan/tenant override, role feature access and action permission all remain enforced. Missing feature configuration fails closed. The existing feature-management UI automatically reads the catalogue; navigation requires both clinical read permission and entitlement.

The existing RBAC and entitlement helpers accept an optional transaction client without changing their default behavior. Clinical transactions use it throughout so authorization does not allocate nested pool connections. All clinical writes lock Registration first, serializing saves, issuance, correction and cancellation. Database-backed concurrent issuance tests verify uniqueness and prevent pool starvation.

Clinical API success responses explicitly use private/no-store caching. Pages render dynamically; middleware includes the prescriptions prefix. Clinical error mapping preserves shared public status codes while withholding unexpected database payloads from generic error logs. Prisma query/error payload logging is disabled because it can contain notes or medications; controlled route reporting remains available.

## Routes, services and UI

Routes:

- `/registration/[id]/consultation`: responsive split consultation/medication workspace.
- `/prescriptions`: paginated server search and patient/code/Doctor/number, clinic, Doctor, status and issuance-date filters.
- `/prescriptions/[id]`: immutable detail, version links, authorized correction/cancellation.
- `/prescriptions/[id]/print`: a separate route group outside dashboard chrome.

API endpoints:

- GET/POST `/api/registrations/[id]/consultation`: retrieve context/draft and atomically save consultation plus medications.
- GET `/api/prescriptions`: scoped paginated history/filtering.
- GET `/api/prescriptions/[id]`: scoped detail.
- POST `/api/prescriptions/[id]/issue`: finalize the reviewed draft revision.
- POST `/api/prescriptions/[id]/correct`: create a new clinical correction draft.
- POST `/api/prescriptions/[id]/cancel`: retain and void an issued document.

Service functions: `getConsultationForRegistration`, `saveConsultationDraft`, `buildPrescriptionSnapshot`, `issuePrescription`, `createCorrectedPrescription`, `cancelPrescription`, `getPrescriptionForActor`, `listPrescriptionsForActor`, `listPatientPrescriptions`, `getPrescriptionFilterOptions`. Shared validation, number generation, issue-date boundaries, API privacy and page access helpers remain separate modules. Medication CRUD/reordering is deliberately batched into a single atomic draft-save operation rather than exposing redundant item endpoints.

UI components: `ConsultationWorkspace`, `MedicationBuilder`, `PrescriptionDocument`, `PrescriptionActions`, `PrescriptionHistory`, `PrintButton`. They reuse existing Button/Input/Textarea/Select/Modal primitives and design tokens. Medication shortcuts support custom text, addition, removal, duplication, ordering and inline validation. Unsaved changes are indicated and page unload is warned. Failed saves preserve entered content.

Registration detail displays Start Consultation, Continue Consultation or View Prescription according to state, plus issued print links and bounded patient prescription history. It does not fetch clinical context for administrative-only users. The full patient history link retains server clinic isolation.

Print uses HTML, `@page` A4 margins and print CSS, black document typography, clinic branding/contact, Doctor credentials, patient/visit identity, clinical sections, ordered medication table and Doctor identification/signature area. Table headers repeat and medication rows/signature avoid page breaks where possible. The toolbar is hidden during print. Draft official print routes return not found; cancelled/superseded prints are clearly historical. Print invokes `window.print()`; browser Save as PDF needs no backend PDF infrastructure. No native operating-system print dialog is automated.

## Audit behavior

Central audited actions and descriptions: CONSULTATION_CREATED, CONSULTATION_UPDATED, PRESCRIPTION_DRAFT_CREATED, PRESCRIPTION_CORRECTION_CREATED, PRESCRIPTION_ISSUED, PRESCRIPTION_SUPERSEDED, PRESCRIPTION_CANCELLED. A dedicated Prescriptions audit category is available to existing audit filters.

Explicit saves are audited; keystrokes are not. Lifecycle audit entries commit with their transaction and contain IDs, number, clinic and state. Notes, patient demographics, medicines and cancellation narrative are excluded from broad audit metadata; cancellation narrative stays on the clinical record.

## Backfill and rollout

`npm run prescriptions:backfill` is read-only dry-run by default. It installs only the prescription feature/Standard plan link when absent and proposes role additions only for exact literal pre-EP system Doctor/Admin snapshots. Customized, malformed, partially upgraded and older role sets remain untouched. Previous permission-stage snapshots are held against captured pre-change data in regression tests. Apply re-locks/rechecks each role before writing. Existing feature switches, plan links and overrides are preserved.

Remote writes require reviewed authorization and `--apply --allow-remote`. No remote apply was run. Deploy schema/code first, dry-run the entitlement/role backfill, review exact eligible role IDs, then explicitly approve any production apply. Other plans require an explicit commercial entitlement decision. Complete each prescribing Doctor's credentials and confirmed portal link, then perform signed-in clinic/role smoke acceptance. Application code does not grant roles when linking a Doctor.

`npm run verify:prescriptions` is read-only and checks catalogue/defaults, deployed clinical tables, nullable Doctor credential columns, lifecycle unique indexes, restricted deletion, feature and Standard-plan installation.

## Verification and practical limits

All validation used a disposable MariaDB 11.4 database on `127.0.0.1:33311/medcare_ep`, with a process-local DATABASE_URL override. The production `.env` was unchanged.

| Check | Result |
| --- | --- |
| Prisma format, validate, generate | Passed |
| Full `npm run build`, including all 32 migrations from an empty local database | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed: zero errors, five existing unrelated warnings |
| `npm test -- --maxWorkers=4` | 150 files, 2,254 tests passed |
| `npm run test:prescriptions` | 58 real database checks passed |
| `npm run verify:prescriptions` | Nine read-only checks passed |
| `npm run test:e2e:prescriptions` | Four Chromium browser tests passed |
| Existing registration, roles, AP-5 conversion, Stage 8 and Stage 9 verification scripts | Passed |
| `git diff --check` | Passed |

Database checks include concurrent lifecycle operations, exact Doctor identity, tenant/clinic isolation, stale revisions, frozen snapshots after live profile edits, correction/cancellation preservation, restricted deletion, feature layers and actual local dry-run/apply backfill behavior. Browser checks include the complete two-medication visit workflow, review and issuance, history and correction, print invocation, spoofed ownership and foreign IDs, mobile validation retention, Doctor credential editing and reasoned cancellation.

Three existing verification fixtures required alignment with already established behavior: registration walk-in Doctors must belong to the visit clinic; roles verification needs a Standard-plan entitlement and current Tasks/personal-settings expectations; Doctor appointment conversion verification needs an explicit portal link. No appointment conversion behavior was changed.

Validation logs and desktop/mobile/print screenshots are preserved in `C:/Users/hp/.codex/visualizations/2026/09/12/01a095b8-d7be-7b02-a123-f8e4aaa2b3fc/ep-validation`. Synthetic database fixtures are retained in the stopped local container `medcare-ep-validation-20260912`; they can be reviewed by restarting that container. Production migration, backfill and signed-in clinical acceptance remain pending an approved rollout.

Only Phase 1 is implemented. Audio, AI, medicine APIs/recommendations, interactions, pharmacy, delivery, e-signatures, refills and stored/server PDF infrastructure are absent by design. The Doctor remains responsible for entered clinical content; no automatic treatment decisions are made.

Issued snapshots freeze the logo value/URL; externally hosted image bytes are not archived. Existing data-image branding is stored directly in the snapshot. Phase 1 uses the current India issuance-display convention. Filter dropdowns are bounded to 500 clinics/Doctors; larger deployments can extend option search. Pending correction drafts must be completed; draft abandonment is not a new lifecycle action in this phase. Clinical record retention is permanent in normal application flows; privileged direct database maintenance lies outside application authorization.

## Complete file manifest

Modified files (24):

- `package.json`
- `prisma/schema.prisma`
- `scripts/verify-ap5-appointment-conversion.mts`
- `scripts/verify-registrations.mts`
- `scripts/verify-roles.mts`
- `src/app/(dashboard)/registration/[id]/page.tsx`
- `src/components/dashboard/DashboardNav.tsx`
- `src/components/doctors/DoctorForm.tsx`
- `src/components/doctors/DoctorProfile.tsx`
- `src/lib/audit.ts`
- `src/lib/auditDescriptions.ts`
- `src/lib/clinicScope.ts`
- `src/lib/defaultFeatures.ts`
- `src/lib/defaultRoles.ts`
- `src/lib/doctors.ts`
- `src/lib/features.ts`
- `src/lib/moduleFeatures.ts`
- `src/lib/navigation.ts`
- `src/lib/permissions.ts`
- `src/lib/prisma.ts`
- `src/lib/rbac.ts`
- `src/middleware.ts`
- `tests/unit/appointmentPermissionDefaults.test.ts`
- `tests/unit/auditDescriptions.test.ts`

Added files (35):

- `docs/electronic-prescriptions.md`
- `playwright.prescriptions.config.ts`
- `prisma/migrations/20260912120000_electronic_prescriptions/migration.sql`
- `scripts/backfill-prescriptions.mts`
- `scripts/prescription-test-fixture.ts`
- `scripts/test-prescriptions.mts`
- `scripts/verify-prescriptions.mts`
- `src/app/(dashboard)/prescriptions/[id]/page.tsx`
- `src/app/(dashboard)/prescriptions/page.tsx`
- `src/app/(dashboard)/registration/[id]/consultation/page.tsx`
- `src/app/(prescription-print)/prescriptions/[id]/print/page.tsx`
- `src/app/(prescription-print)/prescriptions/[id]/print/print.css`
- `src/app/api/prescriptions/[id]/cancel/route.ts`
- `src/app/api/prescriptions/[id]/correct/route.ts`
- `src/app/api/prescriptions/[id]/issue/route.ts`
- `src/app/api/prescriptions/[id]/route.ts`
- `src/app/api/prescriptions/route.ts`
- `src/app/api/registrations/[id]/consultation/route.ts`
- `src/components/prescriptions/ConsultationWorkspace.tsx`
- `src/components/prescriptions/MedicationBuilder.tsx`
- `src/components/prescriptions/PrescriptionActions.tsx`
- `src/components/prescriptions/PrescriptionDocument.tsx`
- `src/components/prescriptions/PrescriptionHistory.tsx`
- `src/components/prescriptions/PrintButton.tsx`
- `src/lib/prePrescriptionRoles.json`
- `src/lib/prescriptionApi.ts`
- `src/lib/prescriptionDates.ts`
- `src/lib/prescriptionNumber.ts`
- `src/lib/prescriptionPages.ts`
- `src/lib/prescriptionRoleMigration.ts`
- `src/lib/prescriptionValidation.ts`
- `src/lib/prescriptions.ts`
- `tests/e2e/prescriptions.spec.ts`
- `tests/unit/prescriptionRoleMigration.test.ts`
- `tests/unit/prescriptionValidation.test.ts`
