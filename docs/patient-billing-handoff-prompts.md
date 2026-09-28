# Patient Billing — Coding-agent handoff prompts (PB-1 → PB-5)

Run these **in order, one per session and one branch/PR each**. Merge each one
before starting the next. Each prompt is self-contained: paste it as-is.
Before handing off each stage, the orchestrator re-verifies the repo: `git log`,
the previous stage's files, and a grep for stub markers. A stage is "done" only
when its checklist passes on `main`.

Spec for every stage: `docs/patient-billing-prd.md` (commit it to the repo
first, in PB-1).

---

## Shared rules (these are repeated inside every prompt below)

```
GROUND RULES — read before writing any code
1. Read CLAUDE.md, AGENTS.md, docs/PRD.md and docs/patient-billing-prd.md in full.
   The billing PRD is the source of truth for this module. Do NOT add tables,
   columns, pages, permissions or features that it does not list.
2. No new npm dependencies. No payment gateway, no PDF library, no new vendor.
3. Scope from the session, never from the request body. Tenant, clinic, patient,
   doctor, registration, number, status, totals and snapshot are always derived
   server-side. Client bodies are strict Zod objects.
4. Server-side RBAC on every mutating route (src/lib/rbac.ts) AND the `billing`
   feature entitlement (src/lib/features.ts / moduleFeatures.ts). Out-of-scope
   IDs return the same not-found response other modules use.
5. Money: Decimal(10,2) in the DB, 2-decimal strings through the app, integer
   paise inside src/lib/billing/invoiceMath.ts. Never float arithmetic on money.
   Display with src/lib/money.ts (formatRupees).
6. Domain language: "Registration/visit", never "Appointment", for the billed
   encounter. "Bill"/"Invoice" in the UI, "Invoice" in code.
7. Follow the existing prescriptions module (docs/electronic-prescriptions.md,
   src/lib/prescriptions.ts, src/app/api/prescriptions/**) as the reference
   pattern for lifecycle, transactions, locking, audit, API privacy and print.
8. This Next.js version has breaking changes — read node_modules/next/dist/docs/
   for anything routing/data related before writing it.
9. STOP AND ASK (do not guess) if: the spec is silent or contradicts the code;
   a migration would alter or drop an existing column; an existing test must be
   changed to pass; you want to touch registrations/appointments behaviour beyond
   what the stage names; or anything would change existing tenants' roles
   outside the dry-run backfill.
10. Finish with: npm run typecheck, npm run lint (touched files), npm test, and
    the stage's own checks. Report a file manifest (added/modified) and test
    results in the PR description. Do not deploy, do not run remote migrations,
    and do not run any backfill with --apply against a remote database.
```

---

## PB-1: Schema, catalogue entries, backfill and verify scripts (no UI)

```
TASK: MedCare Pro — Patient Billing stage PB-1 (foundation). Branch: feat/billing-pb1-foundation

[Paste GROUND RULES above]

CONTEXT
Patient Billing adds itemised invoices, part-payments and dues per visit. The
full spec is docs/patient-billing-prd.md (commit that file in this PR if it is
not already in the repo). This stage lays the foundation only: no pages, no
API routes.

DO
1. docs:
   - Add docs/patient-billing-prd.md if missing.
   - Apply the §10 "Changes to docs/PRD.md" edits to docs/PRD.md exactly as written.
2. prisma/schema.prisma — add exactly the models and enums in billing PRD §5:
   - models: ClinicBillingSettings, ServiceItem, Invoice, InvoiceLine,
     InvoicePayment, InvoiceNumberSequence
   - enums: ServiceCategory, InvoiceStatus, InvoiceDocumentType,
     InvoicePaymentStatus, PaymentMode, PaymentEntryStatus
   - Use @map snake_case names like the rest of the schema.
   - Foreign-key actions as specified (Restrict on ownership FKs, Cascade only
     for invoice_lines → invoices).
   - Add back-relation fields only on Tenant, Clinic, Patient, Registration,
     Doctor and User. NO new columns on existing tables.
   - Add doc comments explaining active_key (D1), the numbering counter (D7) and
     the registrations.amount sync (D8), in the same comment style the schema
     already uses.
3. Migration: prisma/migrations/<timestamp>_patient_billing/migration.sql, generated
   with `prisma migrate dev --create-only` against a DISPOSABLE local DB, then
   reviewed by hand. It must only CREATE. It must not ALTER or DROP anything
   existing.
4. Catalogue and constants (pure data, no behaviour yet):
   - src/lib/permissions.ts: a "Billing" PermissionGroup with the six keys in
     billing PRD §3. Export BILLING_PERMISSIONS. Because nothing enforces them
     until PB-2/PB-3, mark them `pending: "stage"` with the pendingNote
     "Enforced from PB-2/PB-3".
   - src/lib/defaultFeatures.ts: add the `billing` feature (name "Patient
     billing", CORE, globalEnabled true, inDefaultPlan true).
   - src/lib/moduleFeatures.ts: add `billing: "billing"` to MODULE_FEATURES.
   - src/lib/defaultRoles.ts: grants per billing PRD §3 for new tenants. Do NOT
     rewrite the existing arrays' order; append.
   - src/lib/audit.ts + src/lib/auditDescriptions.ts: the eleven actions in
     billing PRD §7 and a Billing category.
   - src/lib/notifications.ts: add types invoice.cancelled, payment.voided and
     invoice.discount_override, with labels. Do not add notify* functions yet.
5. Pure helpers with unit tests (tests/unit/):
   - src/lib/billing/invoiceMath.ts: the paise arithmetic in billing PRD §5
     "Arithmetic". Exports computeLine, computeTotals, discountPercent,
     derivePaymentStatus, toPaise and fromPaise. Tests must cover
     round-half-up, the odd-paise CGST/SGST split, discount = gross, zero
     subtotal, and 999 × ₹99,999.99 without overflow.
   - src/lib/billing/financialYear.ts: financialYearFor(instant) → "2627",
     computed in India time. Test 31 Mar 23:59 IST vs 1 Apr 00:00 IST, and a
     UTC instant that is already 1 Apr in IST.
   - src/lib/billing/invoiceNumber.ts: formatInvoiceNumber(prefix, fy, seq) →
     "INV-2627-00001". Assert ≤16 chars; reject seq > 99999.
   - src/lib/billing/amountInWords.ts: Indian numbering ("Rupees One Lakh Twenty
     Thousand Five Hundred and Paise Fifty Only"). Test 0, paise-only, lakh and
     crore values.
   - src/lib/billing/gstin.ts: format validation (15 chars, state code
     01–38/97/99, PAN pattern, checksum). Test known-valid and known-invalid
     samples.
6. Backfill and verify, modelled on scripts/backfill-prescriptions.mts,
   src/lib/prescriptionRoleMigration.ts and src/lib/prePrescriptionRoles.json:
   - src/lib/preBillingRoles.json: literal snapshots of the current system role
     permission arrays (CLINIC_ADMIN, RECEPTIONIST, STAFF, DOCTOR) as they are
     on main today.
   - src/lib/billingRoleMigration.ts: planBillingRoleMigration(role), with the
     same statuses as the prescription version, plus a unit test.
   - scripts/backfill-billing.mts: dry-run by default; --apply;
     --allow-remote required for non-local DATABASE_URL. It installs the
     feature and the Standard-plan link if absent, and applies role top-ups
     only for ELIGIBLE roles.
   - scripts/verify-billing.mts: read-only checks that the tables, unique
     indexes (active_key, [clinic_id, invoice_number], replaces_invoice_id),
     the feature row and the Standard-plan link all exist.
   - package.json scripts: "billing:backfill" and "verify:billing".

DO NOT
- Build services, API routes, pages or navigation entries.
- Touch src/lib/registrations.ts, src/lib/reports.ts or appointment code.

ACCEPTANCE
- prisma format/validate/generate pass.
- `npm run build` from an empty local DB applies all migrations.
- typecheck, lint and test pass.
- Existing moduleFeatures/catalogue tests still pass, with the new key covered.
- On a local DB seeded before this migration, verify:billing passes after a
  local backfill --apply, and the dry-run output lists the eligible role IDs.

STOP AND ASK if a current system role array on main differs from what
defaultRoles.ts says, or if the migration generator wants to alter any existing
table.
```

---

## PB-2: Billing settings and service price list

```
TASK: MedCare Pro — Patient Billing stage PB-2 (settings + price list). Branch: feat/billing-pb2-catalogue

[Paste GROUND RULES above]

CONTEXT
PB-1 is merged: schema, permissions (pending), feature and pure helpers exist.
Spec: docs/patient-billing-prd.md §4.1–4.2 (FR-11.1 to FR-11.6), §6, §7.
First verify PB-1 is really on main: the models exist in prisma/schema.prisma,
src/lib/billing/* exist, and `npm run verify:billing` exists. If anything is
missing, STOP and report it.

DO
1. src/lib/billing/billingValidation.ts: Zod schemas for settings and service
   items:
   - prefix /^[A-Z0-9]{1,4}$/
   - GSTIN via gstin.ts
   - limit 0–100
   - footer ≤500
   - price 0–99,999,999.99, with no default
   - tax 0–40, 2 decimals
   - SAC /^\d{1,8}$/
   - name 1–120, trimmed
2. src/lib/billing/billingSettings.ts:
   - getBillingSettingsForClinic(actor, clinicId, tx?): returns defaults when no
     row exists
   - saveBillingSettings(actor, clinicId, input): upsert; audit
     BILLING_SETTINGS_UPDATED
3. src/lib/billing/serviceItems.ts:
   - listServiceItemsForActor(actor, {clinicId?, includeInactive?})
   - listBillableServicesForClinic(clinicId): active items that are tenant-wide
     or belong to that clinic
   - createServiceItem, updateServiceItem (including isActive retire/restore)
   - App-level duplicate-name check per scope (see the AppointmentType NULL
     note in schema.prisma).
   - FR-11.6: reject a non-zero tax rate on a clinic-scoped item when that
     clinic has no GSTIN. Tenant-wide taxed items are allowed; issue-time
     re-check happens in PB-3.
   - Audit SERVICE_ITEM_CREATED and SERVICE_ITEM_UPDATED.
4. API routes (strict Zod; permission billing:settings:manage for writes,
   invoice:read for reads; feature `billing`):
   - src/app/api/billing/services/route.ts (GET, POST)
   - src/app/api/billing/services/[id]/route.ts (PATCH)
   - src/app/api/billing/settings/[clinicId]/route.ts (GET, PUT)
5. UI:
   - src/app/(dashboard)/settings/billing/page.tsx, plus an entry in
     src/lib/settingsSections.ts (view: invoice:read; manage:
     billing:settings:manage).
   - Components under src/components/billing/: BillingSettingsForm (per-clinic,
     with a clinic selector using the existing selectedClinic pattern) and
     ServiceItemList + ServiceItemForm (category filter, active/retired toggle,
     scope "All clinics" vs a specific clinic).
   - Reuse the existing Button/Input/Select/Modal primitives and design tokens.
6. Remove `pending` from billing:settings:manage and invoice:read in
   permissions.ts, since both are now enforced.
7. Tests:
   - unit tests for the validation schemas
   - a DB-backed script scripts/test-billing.mts (pattern:
     scripts/test-prescriptions.mts) covering tenant/clinic isolation, the
     duplicate-name rule including tenant-wide NULL scope, the GSTIN-gated tax
     rule, retire/restore, and a Receptionist denied writes
   - package.json "test:billing"

DO NOT build invoices, payments or navigation beyond the settings section.

ACCEPTANCE: typecheck/lint/test pass; test:billing passes on a disposable local
DB; a Receptionist sees the price list read-only; Staff from Clinic A cannot
read Clinic B settings by ID.
```

---

## PB-3: Invoice drafts, issue, numbering, registration sync

```
TASK: MedCare Pro — Patient Billing stage PB-3 (invoices). Branch: feat/billing-pb3-invoices

[Paste GROUND RULES above]

CONTEXT
PB-1 and PB-2 are merged. Spec: docs/patient-billing-prd.md §4.3 (FR-11.7 to
FR-11.15), §2 decisions D1, D6, D7, D8, D11 and D12, and §5–§7. Reference
pattern: src/lib/prescriptions.ts (issuePrescription: lock the Registration
first, reload ownership, validate, number, snapshot, audit — all in one
transaction; RBAC/entitlement helpers take the tx client).
Verify PB-2 is on main before starting.

DO
1. src/lib/billing/invoices.ts:
   - getLiveInvoiceForRegistration(actor, registrationId)
   - createDraftInvoice(actor, registrationId):
     - active_key = registrationId
     - prefill per FR-11.8
     - doctorId copied from the registration
   - saveDraftInvoice(actor, invoiceId, {revision, lines[]}):
     - replace lines atomically
     - recompute totals with invoiceMath
     - a stale revision returns 409
     - serviceItemId must be billable at the invoice's clinic
     - custom lines are allowed
   - issueInvoice(actor, invoiceId, {revision}): all checks and effects in
     FR-11.10 to FR-11.13, in ONE transaction:
     - lock the registrations row first (SELECT … FOR UPDATE), then the invoice
     - re-check the GSTIN/tax rule against current clinic settings
     - enforce the discount limit against invoice:discount:override; if the
       limit is exceeded and the actor holds it, flag a discount-override
       notification for PB-4 to emit (store a boolean in the audit metadata now)
     - allocate the number via invoice_number_sequences (upsert then
       SELECT … FOR UPDATE, increment)
     - document type per FR-11.12
     - snapshot per FR-11.13
     - set registrations.amount = grand_total and write a registration_edit_log
       row with the SAME changed_fields shape updateRegistration writes
       ({"amount":{"from":"…","to":"…"}}). Today those rows are written inline
       in src/lib/registrations.ts (tx.registrationEditLog.create, near
       insertRegistrationWithin and updateRegistration; the role-at-time comes
       from resolveRoleNameAtTime in rbac.ts). Extract ONE small exported
       helper, e.g. writeRegistrationAmountChange(tx, …), next to them and use
       it from billing. Do not change how the existing call sites behave.
     - audit INVOICE_ISSUED
     - a zero grand total → payment_status PAID, balance_due 0
     - retry the whole transaction on deadlock/unique-collision (bounded), like
       prescriptions
   - discardDraftInvoice(actor, invoiceId): FR-11.15
   - getInvoiceForActor, listInvoicesForActor (FR-11.21 filters, pagination)
2. src/lib/registrations.ts — ONE targeted change: in updateRegistration, if
   the `billing` feature is enabled for the tenant AND a live ISSUED invoice
   exists for the registration AND input.amount differs from the current
   amount, throw the module's conflict error (409) with the message "This visit
   has been billed — change the bill instead." Nothing else in this file
   changes. Add a regression test.
3. API routes (Cache-Control private, no-store; strict Zod):
   - src/app/api/registrations/[id]/invoice/route.ts (GET live, POST create draft)
   - src/app/api/invoices/route.ts (GET list)
   - src/app/api/invoices/[id]/route.ts (GET, PUT save draft)
   - src/app/api/invoices/[id]/issue/route.ts
   - src/app/api/invoices/[id]/discard/route.ts
4. Pages and components:
   - src/app/(dashboard)/registration/[id]/bill/page.tsx: the draft editor.
     InvoiceEditor + InvoiceLineBuilder, with:
       - a service picker filtered to billable items
       - custom lines, qty, rate, discount (₹ or % input → ₹)
       - live totals (computed with the same invoiceMath on the client)
       - unsaved-changes warning, and entered content kept when a save fails
       - Review → a separate explicit "Issue bill" confirmation
   - src/app/(dashboard)/billing/page.tsx: list with filters
   - src/app/(dashboard)/billing/[id]/page.tsx: detail rendered from the
     snapshot when issued; an InvoiceDocument component shared with PB-5 print
   - src/app/(dashboard)/registration/[id]/page.tsx: add
     Create / Continue / View bill actions plus a payment-status badge
     (FR-11.7). Do not fetch billing data for users without invoice:read.
   - Navigation: a "Billing" entry in src/lib/navigation.ts (requires
     invoice:read + the billing feature); add the /billing and
     /registration/*/bill prefixes to src/middleware.ts the same way
     prescriptions did.
5. Remove `pending` from invoice:create and invoice:discount:override.
6. Tests (extend scripts/test-billing.mts and add unit tests):
   - concurrent issue of 20 invoices in one clinic → numbers 00001–00020 with
     no gaps or duplicates
   - two clinics have independent sequences
   - the FY rollover at 1 April IST resets the sequence
   - one live invoice per registration (a second POST → conflict)
   - stale revision → 409
   - GSTIN/tax rule enforced at issue
   - the discount limit is enforced with and without the override
   - snapshot unchanged after patient/clinic/doctor profile edits
   - registrations.amount synced + an edit-log row written
   - the registration amount edit is blocked after issue, but other fields
     are still editable
   - cross-tenant/clinic IDs → not found
   - a Staff role cannot create
   - billing feature disabled → registrations behave exactly as before

STOP AND ASK if: extracting the edit-log helper would change existing log output; locking the
registration conflicts with an existing prescription lock order; or
appointment conversion (src/lib/appointmentConversion.ts) would need changing.
It should NOT need changing.
```

---

## PB-4: Payments, voids, cancellation, replacement, dues, notifications

```
TASK: MedCare Pro — Patient Billing stage PB-4 (payments + dues). Branch: feat/billing-pb4-payments

[Paste GROUND RULES above]

CONTEXT
PB-1 to PB-3 are merged. Spec: docs/patient-billing-prd.md §4.4–4.5 (FR-11.16 to
FR-11.20), FR-11.24, §5 invoice_payments. Verify PB-3 is on main.

DO
1. src/lib/billing/payments.ts:
   - recordPayment(actor, invoiceId, input): FR-11.16
     - lock the invoice row
     - ISSUED only
     - 0 < amount ≤ balance_due
     - received_at defaults to now and must not be later than now + 5 minutes
     - recompute amount_paid, balance_due and payment_status with invoiceMath
       in the same transaction
     - audit PAYMENT_RECORDED
   - voidPayment(actor, invoiceId, paymentId, reason): FR-11.17
     - invoice:cancel
     - recompute totals
     - audit PAYMENT_VOIDED
     - notify payment.voided
2. src/lib/billing/invoices.ts, add:
   - cancelInvoice(actor, invoiceId, reason): FR-11.19
     - lock the registration first, then the invoice
     - no ACTIVE payments
     - active_key → NULL
     - registrations.amount → 0 with an edit-log row, using the same helper
       as PB-3
     - audit INVOICE_CANCELLED
     - notify invoice.cancelled
   - createReplacementInvoice(actor, cancelledInvoiceId): FR-11.20
     - clone the lines
     - set replaces_invoice_id
     - fail with a conflict if a live invoice already exists
     - audit INVOICE_REPLACEMENT_CREATED
   - Emit invoice.discount_override from issueInvoice when PB-3's flag is set.
3. src/lib/notifications.ts: add notifyInvoiceCancelled, notifyPaymentVoided and
   notifyInvoiceDiscountOverride, following the notifyRegistrationUpdated
   pattern (Admin/Owner visibility, clinic-scoped, related_record_id =
   invoice id). The notification message contains the invoice number and
   amount, never patient demographics.
4. src/lib/billing/dues.ts: listDuesForActor(actor, filters) per FR-11.18, with
   the age bucket computed from issued_at in India time, a total, and a CSV
   builder that follows src/lib/registrationCsv.ts (header "Balance due (INR)",
   unformatted numbers).
5. API:
   - src/app/api/invoices/[id]/payments/route.ts (POST)
   - src/app/api/invoices/[id]/payments/[paymentId]/void/route.ts
   - src/app/api/invoices/[id]/cancel/route.ts
   - src/app/api/invoices/[id]/replace/route.ts
   - src/app/api/invoices/dues/route.ts (GET, ?format=csv requires reports:export)
6. UI:
   - On /billing/[id]: a payments panel (RecordPaymentForm, PaymentList with a
     Void action behind a reason modal), a Cancel bill action (confirmation
     modal + reason; disabled with an explanation while active payments exist),
     and a Create replacement action on cancelled bills.
   - src/app/(dashboard)/billing/dues/page.tsx: the dues list (DuesTable,
     filters, total, CSV).
   - The registration detail badge now reflects UNPAID/PARTIAL/PAID.
7. Remove `pending` from payment:record and invoice:cancel.
8. Tests:
   - concurrent payments that would together exceed the balance → exactly one
     succeeds
   - void restores the balance and status
   - cancel is blocked with active payments
   - cancel sets registrations.amount to 0 with a log row
   - replacement → issue gives a new number and sets the amount again
   - only one replacement per cancelled invoice
   - dues buckets at the 7/8 and 30/31 day boundaries
   - notifications are created and visible to Admin but not Staff
   - Receptionist can record but cannot void or cancel

STOP AND ASK if you believe refunds or overpayments are needed to make any flow
work. They are out of scope by decision.
```

---

## PB-5: Print and collections report

```
TASK: MedCare Pro — Patient Billing stage PB-5 (print + collections report). Branch: feat/billing-pb5-print-reports

[Paste GROUND RULES above]

CONTEXT
PB-1 to PB-4 are merged. Spec: docs/patient-billing-prd.md FR-11.22 and FR-11.23.
Reference: src/app/(prescription-print)/prescriptions/[id]/print/page.tsx and
print.css, src/lib/reports.ts, src/lib/reportPeriods.ts,
src/app/(dashboard)/reports/page.tsx and src/lib/reportCsv.ts.
Verify PB-4 is on main.

DO
1. Print:
   - src/app/(invoice-print)/billing/[id]/print/page.tsx + print.css
   - Include a layout.tsx if the prescription print group has one.
   - Render only from the invoice snapshot, reusing the InvoiceDocument
     component from PB-3 (extend it; do not fork it).
   - A4 @page margins and black print typography.
   - Content:
     - document-type title (Invoice / Tax Invoice / Bill of Supply)
     - clinic block with the GSTIN when present
     - the line table, totals and CGST/SGST
     - amount in words (amountInWords.ts)
     - the payments table and balance due, read live from invoice_payments;
       payments are not part of the frozen snapshot, so label that block
       "Payments as of <print time>"
     - footer note and "This is a computer-generated document."
   - The toolbar is hidden when printing, and a PrintButton calls
     window.print().
   - Drafts → not found. Cancelled → a "CANCELLED" watermark plus the reason.
   - Table headers repeat across pages, and totals avoid page breaks.
2. Collections report:
   - src/lib/billing/collectionsReport.ts: getCollectionsReport(actor, filters)
     using the SAME ReportFilters/period helpers as getRevenueReport. It returns
     billed, collected, outstanding, discounts, cgst, sgst, a per-bucket series
     for billed and collected, and breakdowns by payment mode and by clinic.
     Semantics are in FR-11.23:
       - billed by issued_at, excluding CANCELLED invoices
       - collected by received_at for ACTIVE payments only
       - outstanding is point-in-time
     Use India-time bucket boundaries consistent with issue instants.
   - src/app/api/reports/collections/route.ts (+ export with reports:export),
     gated by report:read AND invoice:read AND the billing feature.
   - src/app/(dashboard)/reports/page.tsx: add a "Billing" section/tab, visible
     only with invoice:read. It shows KPIs (src/components/reports/KpiTiles.tsx), a Billed vs Collected chart
     reusing src/components/reports/GrowthChart.tsx, and the breakdown tables
     (BreakdownTable.tsx, ExportCsvLink.tsx). Add the note:
     "Revenue is by visit date. Collections are by payment date."
   - DO NOT change getRevenueReport, adminDashboard revenue or their existing
     outputs.
3. Tests:
   - collections totals on a fixture with a mix of partial, voided and
     cancelled invoices
   - bucket boundaries at IST midnight
   - clinic-scoped actor totals
   - Playwright spec tests/e2e/billing.spec.ts plus playwright.billing.config.ts
     (pattern: playwright.prescriptions.config.ts) covering: create bill from a
     registration → add service + custom line → discount → issue → record a
     partial UPI payment → dues list shows it → record the rest → PAID → print
     page renders → cancel is blocked while paid → void → cancel → replacement.
     Also desktop and mobile widths.
   - package.json "test:e2e:billing"
4. Write docs/patient-billing-implementation-report.md in the same structure as
   docs/electronic-prescriptions.md: architecture, lifecycle, security,
   verification table and complete file manifest across PB-1..PB-5. Mark the
   §7 rows in docs/PRD.md "Built".

STOP AND ASK if the existing chart component cannot show two series without
modification, or if report period helpers assume registrations.visitDate
wall-clock semantics in a way that cannot be reused for instants.
```