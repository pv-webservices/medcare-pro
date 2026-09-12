# Phase 1 Secure Patient Portal — implementation and review report

Status: **READY FOR INDEPENDENT REVIEW**. Production verification delivery is intentionally unavailable pending a reviewed adapter. This is not a deployment or production acceptance statement.

Branch: `codex/patient-portal-phase1`. Baseline main: `3bfde194cddbb42874c61c671af34ba614574d67`. Obtain the finished commit with `git rev-parse HEAD` on this branch. Work and validation used disposable localhost databases only; no merge, deployment, production mutation, paid call, or provider provisioning was performed.

## Architecture and database

Patient identities are separate from staff `User`, NextAuth, RBAC and staff sessions. The six new tables are accounts, SELF links, activation challenges, OTP challenges, sessions and patient audit events. Account mobile is normalized Indian E.164 and unique. Nullable unique live-link keys enforce one active account per Patient and one active Patient per account. Composite foreign keys enforce Patient/tenant ownership and session/account/link-generation agreement. Four CHECK constraints prevent null-key cardinality bypasses, invalid challenge subjects and excessive attempts. Identity foreign keys restrict deletion; optional staff verifier/revoker references use SET NULL. Clinical records are never cascade-deleted through portal identity.

The additive migration is `20260913010000_patient_portal_phase1`. It adds identity structures and the Patient composite ownership index, with no automatic accounts, links, mobile matching, or clinical-data rewrite. The database test replays all 33 migrations from empty and upgrades from the exact 32-migration main baseline. It compares Patient, Registration and issued snapshot data before and after the upgrade and asserts zero portal accounts/links.

## Authentication and authorization

Staff must hold `patient_portal:manage` at the Patient's clinic and confirm identity verification. Enable/resend creates a random 32-byte activation token, persists its SHA-256 hash, and sends the raw URL through the delivery interface. The token expires after 24 hours; resending invalidates the prior token. Activation also requires OTP verification and rechecks the current Patient mobile snapshot before creating an ACTIVE SELF link. There is no mobile-based automatic linking.

OTP codes are cryptographically generated six-digit values, stored as secret-peppered HMAC digests scoped to challenge identity. They expire after ten minutes and allow five attempts. Wrong attempts commit even when verification fails. Patient row locks serialize redemption, resend and revocation; concurrent activation redeems exactly once. Database-backed hourly limits are 20 requests/50 verifications per IP and 5 requests/15 verifications per subject, with a 60-second request/resend cooldown. Staff activation is separately bounded. Login request responses are generic for known/unknown mobiles, including entitlement denial; missing delivery configuration gives the same availability failure.

The independent `medcare_patient_session` cookie is HttpOnly, SameSite=Lax, path `/`, Secure in production and has an absolute twelve-hour lifetime without sliding extension. Only a token hash is persisted. Every protected read resolves a live session → ACTIVE account → ACTIVE SELF link → exactly one Patient and tenant. Even a previously resolved actor is revalidated before record reads. Patient actors cannot become staff actors, and staff cookies do not authenticate patient routes.

All visit, appointment and prescription queries include server-derived Patient and tenant ownership, including clinic/Patient tenant consistency. Request bodies and query strings cannot supply authority. Strict schemas reject extra `patientId`, `tenantId` and `clinicId`. Missing, foreign and draft records return 404. Lists are bounded to twenty records per page. State changes require the configured same origin and reject missing/foreign Origin and cross-site requests. Sensitive responses/pages use no-store and no-referrer policies.

Staff revocation disables the account, revokes links, pending challenges and every session without touching clinical history. An already logged-in browser immediately receives 401 and redirects to login on reload. Re-enabling creates a fresh link generation; old cookies remain unusable.

## Entitlements and role migration

`patient_portal` is a CORE feature included in the default Standard plan. Authority follows global availability plus tenant plan/override and active tenant status. It never depends on staff `RoleFeatureAccess`; tenant-only features are excluded from staff role switches. Patient historical prescriptions remain accessible without the staff prescriptions feature.

New default Admin and Receptionist roles receive management permission; Doctor and Staff do not. Owner retains existing wildcard behavior. Historical role snapshots for older migrations explicitly exclude the new permission so those backfills retain their original matching semantics.

`npm run patient-portal:backfill` defaults to dry-run. Apply adds catalogue/plan mapping while preserving explicit switches and upgrades only exact frozen historical system Admin/Receptionist permission sets. Customized roles are reported and preserved. Writes against a remote database require both `--apply --allow-remote`; local apply was tested. No backfill creates patient identities or sends messages. Remote apply is a separate reviewed operation.

## Patient-visible records and UI

Completed: scoped staff Portal card with enable/resend/revoke/re-enable confirmations; patient login and activation; separate patient navigation and dashboard; visits, linked appointments, prescriptions, prescription detail and print/Save PDF; profile; logout; desktop and mobile layouts.

Patient prescription DTOs explicitly select visible fields from immutable issuance snapshots. ISSUED, SUPERSEDED and CANCELLED history remains readable with status warnings and ownership-checked correction links. DRAFT is invisible. Raw snapshots, internal IDs, staff account data, internal consultation workspace fields, generic audit content and cancellation reasons are omitted. Printing performs independent patient authorization and excludes staff chrome. An existing visit-history locale mismatch discovered during browser validation was corrected to deterministic `en-IN` formatting.

## Verification

| Check | Result |
| --- | --- |
| Full Vitest suite | PASS: 152 files, 2,293 tests |
| Portal focused unit suite | PASS: 2 files, 39 tests |
| Portal disposable DB suite | PASS: 75 checks |
| Portal read-only verifier | PASS: 14/14 checks |
| Portal Playwright | PASS: 4/4 desktop/mobile tests |
| Migration verification | PASS: 3 checks, empty-chain and baseline upgrade |
| Prescription DB regression | PASS: 58 checks |
| Prescription schema/catalogue verifier | PASS: 9 checks |
| Registration regression | PASS: all checks |
| Appointment conversion regression | PASS: all checks |
| RBAC/default-role regression | PASS: all checks |
| Stage 8 feature and Stage 9 entitlement regressions | PASS: all checks |
| Prisma generation | PASS |
| Typecheck | PASS: `npm run typecheck`, exit 0 |
| Lint | PASS: 0 errors, 5 existing warnings |
| Production build | PASS: `npx next build`, 102 generated pages |
| Staff prescription Playwright regression | PASS: 26/26 tests |

Browser checks exercised actual staff activation, private test delivery, OTP redemption, patient navigation, immutable historical prescriptions, print invocation, missing/foreign records, malformed ownership inputs, staff/patient session separation, logout/login, generic login responses, origin rejection, cooldown and immediate staff revocation. Mobile home/print screenshots were preserved outside the repository and visually inspected.

## IDOR and identity matrix

| Attack / access | Result |
| --- | --- |
| A → A visit | PASS: allowed |
| A → B visit | PASS: 404 |
| A → A Rx | PASS: allowed for issued history |
| A → B Rx | PASS: 404 |
| A → foreign-tenant Rx | PASS: 404 |
| A → A DRAFT Rx | PASS: 404 |
| A → B print | PASS: 404 |
| A → foreign appointment | PASS: 404 |
| Tampered patientId | PASS: 400; cannot widen authority |
| Tampered tenantId | PASS: 400; cannot widen authority |
| Tampered clinicId | PASS: 400; cannot widen authority |

Two synthetic Patients shared one mobile. Activation of the second Patient was blocked; the first account saw only its verified Patient's records. Unlinked appointments with the same mobile remained hidden. Editing Patient demographics did not transfer an established account's identity; editing a pending activation's mobile invalidated redemption. Concurrent activation, exhausted/expired OTP, revoked/expired session, disabled account, feature kills, plan denial and fresh-generation reactivation were independently tested.

## Security findings and deployment prerequisites

- P0: no unresolved portal finding identified by the implemented automated checks and review.
- P1: no unresolved portal finding identified. Independent security review remains necessary.
- P2: production delivery is absent by design. Configure a reviewed security-message adapter, delivery failure policy and operational abuse monitoring before activation is offered to patients. Generic response bodies do not constitute proof of constant-time delivery behavior; review timing and provider failure behavior when integrating that adapter.
- P3: five pre-existing lint warnings and existing Next middleware/package-type build warnings remain. Dependency audit reports eight existing advisories (one critical, five high, two moderate); no dependency upgrades were included. Advisory severity requires a separate applicability assessment and is not reclassified as a low-severity portal issue.

The only verification transport exercised was the explicit local-file test sender. It requires non-production mode, a localhost database with the dedicated disposable prefix and a private configured outbox outside HTTP paths. Production and remote-database use are rejected. No OTP/token enters HTTP responses, application logs, generic audit rows or clinical message history. No SMS/WhatsApp provider was used or charged.

Validation setup issues were corrected before final runs: the initial migration CHECK rejected Prisma's default ON UPDATE CASCADE, so identity ownership keys now explicitly use ON UPDATE RESTRICT; OTP browser fixtures were isolated per test to avoid shared cooldown state; the upgrade verifier launches separate processes because Prisma's singleton retains its construction-time database URL. One overlapping Prisma generation attempt hit a Windows DLL lock; generation was rerun successfully after database processes exited. Initial typecheck failures in nullable test assertions were fixed; final typecheck and build passed. These failed attempts are not counted as passing checks.

Runtime configuration used disposable MariaDB 11.4 on localhost, never the repository's production database. Synthetic fixtures and private browser screenshots are retained locally for review. No real patient data or credentials were used as test fixtures. Existing dependency advisories include direct Next (critical), Prisma (high) and Vitest (moderate), plus transitive advisories; no claim is made about exploit applicability from audit severity alone.

Review entry points: `patientPortalSession.ts` and `patientPortalRecords.ts` hold patient authority and ownership predicates; activation/OTP/security modules hold authentication lifecycle; `patientPortalFeature.ts` holds tenant-only entitlement; `patientPortalRoleMigration.ts` and the frozen `prePatientPortalRoles.json` hold conservative backfill matching. API routes delegate to those services, while patient/staff UI components only render their authorized results. Existing staff session, appointment scheduling, prescription issuance and telephony services remain the established domain implementations.

Before deployment: independently review the feature and dependency advisories; configure a strong server-only `PATIENT_PORTAL_OTP_SECRET` of at least 32 characters, HTTPS `AUTH_URL`/`NEXTAUTH_URL` matching the public origin, and a reviewed production delivery adapter; approve the additive migration and exact dry-run role candidates; preserve explicit tenant feature decisions; perform controlled live acceptance and revocation checks. Do not enable the test sender in production. Local green checks do not prove production acceptance.

## Changed files

- `docs/patient-portal-phase1.md`
- `next.config.js`
- `package.json`
- `playwright.patient-portal.config.ts`
- `prisma/migrations/20260913010000_patient_portal_phase1/migration.sql`
- `prisma/schema.prisma`
- `scripts/backfill-patient-portal.mts`
- `scripts/create-patient-portal-e2e.mts`
- `scripts/patient-portal-migration-fixture.mts`
- `scripts/patient-portal-test-fixture.ts`
- `scripts/test-patient-portal-migration.mts`
- `scripts/test-patient-portal.mts`
- `scripts/verify-patient-portal.mts`
- `scripts/verify-stage8-features.mts`
- `src/app/(dashboard)/registration/[id]/page.tsx`
- `src/app/api/patient-portal/[...path]/route.ts`
- `src/app/api/patients/[id]/portal/[action]/route.ts`
- `src/app/api/patients/[id]/portal/route.ts`
- `src/app/patient/(secure)/appointments/page.tsx`
- `src/app/patient/(secure)/layout.tsx`
- `src/app/patient/(secure)/page.tsx`
- `src/app/patient/(secure)/prescriptions/[id]/page.tsx`
- `src/app/patient/(secure)/prescriptions/[id]/print/page.tsx`
- `src/app/patient/(secure)/prescriptions/page.tsx`
- `src/app/patient/(secure)/profile/page.tsx`
- `src/app/patient/(secure)/visits/page.tsx`
- `src/app/patient/activate/[token]/page.tsx`
- `src/app/patient/layout.tsx`
- `src/app/patient/login/page.tsx`
- `src/app/patient/portal.css`
- `src/app/patient/unavailable/page.tsx`
- `src/components/patientPortal/PortalAuthForm.tsx`
- `src/components/patientPortal/PortalButtons.tsx`
- `src/components/patientPortal/PortalHistoryPage.tsx`
- `src/components/patientPortal/PortalPrescription.tsx`
- `src/components/patientPortal/StaffPortalCard.tsx`
- `src/components/registration/PatientVisits.tsx`
- `src/lib/audit.ts`
- `src/lib/auditDescriptions.ts`
- `src/lib/defaultFeatures.ts`
- `src/lib/defaultRoles.ts`
- `src/lib/features.ts`
- `src/lib/moduleFeatures.ts`
- `src/lib/patientPortalActivation.ts`
- `src/lib/patientPortalApi.ts`
- `src/lib/patientPortalFeature.ts`
- `src/lib/patientPortalOtp.ts`
- `src/lib/patientPortalPages.ts`
- `src/lib/patientPortalRecords.ts`
- `src/lib/patientPortalRoleMigration.ts`
- `src/lib/patientPortalSecurity.ts`
- `src/lib/patientPortalSender.ts`
- `src/lib/patientPortalSession.ts`
- `src/lib/patientPortalStaffApi.ts`
- `src/lib/patientPortalTestSender.ts`
- `src/lib/permissions.ts`
- `src/lib/prePatientPortalRoles.json`
- `tests/e2e/patient-portal.spec.ts`
- `tests/unit/appointmentPermissionDefaults.test.ts`
- `tests/unit/auditDescriptions.test.ts`
- `tests/unit/moduleFeatures.test.ts`
- `tests/unit/patientPortalRecords.test.ts`
- `tests/unit/patientPortalSecurity.test.ts`
- `tests/unit/permissions.test.ts`
