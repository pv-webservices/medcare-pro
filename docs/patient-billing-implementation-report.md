# Patient Billing — implementation report (PB-1 → PB-5)

Spec: [`docs/patient-billing-prd.md`](patient-billing-prd.md) (FR-11.1–FR-11.24). Stages were built one branch and PR at a time: PB-1 [#25](https://github.com/pv-webservices/medcare-pro/pull/25), PB-2 [#26](https://github.com/pv-webservices/medcare-pro/pull/26), PB-3 [#28](https://github.com/pv-webservices/medcare-pro/pull/28), PB-4 [#30](https://github.com/pv-webservices/medcare-pro/pull/30), and PB-5 on `feat/billing-pb5-print-reports`, based on `origin/main` at `d3616dc` (29 September 2026). No production deployment, remote migration or backfill apply was performed.

## Architecture and data model

Billing is a per-visit ledger that sits beside the revenue model. It does not replace it. A Registration (visit) has at most one live invoice. The invoice owns its ordered lines and its payments. Ownership (tenant, clinic, registration, patient, doctor) is always derived from the Registration on the server, never from a request body.

One migration, `20260927211833_patient_billing`, only CREATEs: `clinic_billing_settings`, `service_items`, `invoices`, `invoice_lines`, `invoice_payments` and `invoice_number_sequences`, plus six enums. No existing column was added, altered or dropped. Ownership foreign keys are RESTRICT; only `invoice_lines → invoices` cascades. Money is `Decimal(10,2)` in the database, 2-decimal strings through the app, and integer paise inside `src/lib/billing/invoiceMath.ts`.

- **D1, one live invoice per visit:** a nullable unique `active_key` equals the registration id while DRAFT/ISSUED and is NULL once CANCELLED.
- **D7, sequential numbers:** `{PREFIX}-{FY}-{SEQ}`, for example `INV-2627-00001`. Numbers are allocated at issue from a `SELECT … FOR UPDATE` counter per clinic per Indian financial year. `(clinic_id, invoice_number)` is unique.
- **D8, revenue stays on `registrations.amount`:** issue sets it to the grand total, and cancel sets it to 0. Both write a `registration_edit_log` row in the existing `{"amount":{"from","to"}}` shape through one shared helper. Revenue Reports, the dashboard and the CSV export are unchanged.

## Lifecycle

DRAFT → ISSUED → CANCELLED, with a replacement draft after cancellation.

- **Drafts (FR-11.8, FR-11.9):**
  - A new draft is pre-filled with a Consultation line at the visit amount.
  - The whole line set is replaced atomically on each save.
  - Every save bumps `revision`; a stale revision returns 409.
  - A discarded draft becomes CANCELLED with no number.
- **Issue (FR-11.10 to FR-11.13):** one transaction locks the Registration first, then the invoice. It then:
  - re-checks the GSTIN/tax rule and the staff discount limit (the override needs `invoice:discount:override`)
  - allocates the number and fixes the document type (Invoice / Tax Invoice / Bill of Supply)
  - freezes the snapshot: clinic, patient, doctor, visit, lines, totals, number, type and issue instant
  - syncs `registrations.amount` and writes the audit entry
  - retries the whole transaction on deadlock or unique collision

  A zero-total bill is PAID immediately.
- **Issued bills are immutable (FR-11.14):** there is no update or delete endpoint. `updateRegistration` refuses an amount change with 409 while a live issued bill exists.
- **Payments (FR-11.16, FR-11.17):**
  - Recording a payment locks the visit, then the invoice.
  - The amount must be > 0 and ≤ the balance. The received time may be at most 5 minutes ahead of now.
  - `amount_paid`, `balance_due` and `payment_status` are recomputed from the ACTIVE rows.
  - A void keeps the row as VOIDED with its reason and recomputes the totals.
- **Cancel and replace (FR-11.19, FR-11.20):**
  - Cancel is allowed only with no ACTIVE payments. It keeps the number and snapshot, NULLs `active_key` and sets the visit amount to 0.
  - A replacement clones the lines into a new draft with a unique `replaces_invoice_id`, so a cancelled bill has at most one replacement.
  - A cancelled bill keeps its last `balance_due` value as history. Dues and reports therefore filter on `status = ISSUED`, never on the balance alone.

### PB-5: print and collections report

- **Print (FR-11.22):** `/billing/[id]/print` lives in the new `src/app/(invoice-print)` route group, outside the dashboard layout, like prescription print. The prescription print group has no `layout.tsx`, so neither does this one.
  - It renders only from the snapshot, through the shared `InvoiceDocument` component. That component was extended, not forked: it now always shows the amount in words, and takes an optional `printout` block.
  - Payments are not part of the snapshot. They are read live (ACTIVE only) under the heading "Payments as of &lt;print time&gt;", followed by Paid and Balance due.
  - The page shows the footer note and "This is a computer-generated document.".
  - Drafts, and drafts discarded without a number, return not-found. A cancelled bill prints a CANCELLED watermark, a cancellation note with its reason, and "— (cancelled)" for the balance.
  - `print.css` sets `@page` A4 with 14 mm margins, forces black text in print, repeats table headers across pages, keeps rows and totals together, and hides the toolbar. The PrintButton calls `window.print()`.
  - On a phone, the tables scroll inside their own boxes instead of breaking figures.
- **Collections report (FR-11.23):** `src/lib/billing/collectionsReport.ts` → `getCollectionsReport(actor, filters, now)` takes the same `ReportFilters` (period + clinic) as `getRevenueReport`.
  - Billed: ISSUED invoices by `issued_at`.
  - Collected: ACTIVE `invoice_payments` by `received_at`.
  - Outstanding: `SUM(balance_due)` of ISSUED invoices, as of now. This figure is not bound to the period.
  - Discounts, CGST and SGST: ISSUED invoices by `issued_at`.
  - The report also returns the previous period's billed and collected totals, a per-bucket series for each, and breakdowns by payment mode and by clinic.
- **India-time buckets:** `src/lib/billing/billingPeriods.ts` is the one place billing report boundaries are decided.
  - `reportPeriods.ts` buckets UTC-tagged wall-clock dates. Billing instants are shifted +5:30 and then bucketed with the same `startOfPeriod`/`bucketKey`. Range bounds are shifted back −5:30 before they reach the database.
  - The series SQL groups by India calendar day (`DATE_ADD(col, INTERVAL 330 MINUTE)`, where the constant comes from the helper). Those days are rolled into weeks, months and years with the same helper.
  - The collected series counts distinct visits paid for in each bucket.

## Security and entitlement

- **Permissions:** the six billing permissions from PRD §3 (`invoice:read`, `invoice:create`, `payment:record`, `invoice:discount:override`, `invoice:cancel`, `billing:settings:manage`) are all enforced server-side through `src/lib/rbac.ts`, and no longer marked pending.
- **Entitlement:** every service calls `requireModule(actor, billing)`, and missing configuration fails closed. Out-of-scope and cross-tenant ids return the module's usual not-found response.
- **Collections report:** requires the `reports` and `billing` features, plus `report:read` AND `invoice:read`. The clinic list is the intersection of both grants, resolved by the revenue report's own `resolveReportClinics`, which PB-5 exported without changing it. Every query is constrained to the session tenant and that explicit clinic id list. A selected clinic outside that scope returns zeros.
  - The CSV export also needs `reports:export`, intersected in the same way.
  - JSON and CSV responses use `Cache-Control: private, no-store`.
  - The `/reports` page drops the Billing section on a PermissionError or FeatureError, so the Revenue report renders exactly as before.
- **Print page:** goes through `invoiceForActor`, so it needs `invoice:read` in the bill's clinic. The `/billing` middleware prefix already covers it.

## Routes, services and UI

**Pages**
- `/settings/billing`
- `/registration/[id]/bill`
- `/billing`
- `/billing/[id]`: now links to Print bill
- `/billing/dues`
- `/billing/[id]/print` (PB-5)
- `/reports`: Billing section (PB-5)

**API**
- `/api/billing/services`, `/api/billing/services/[id]`, `/api/billing/settings/[clinicId]`
- `/api/registrations/[id]/invoice`
- `/api/invoices`, `/api/invoices/[id]`
- `/api/invoices/[id]/issue`, `/api/invoices/[id]/discard`, `/api/invoices/[id]/cancel`, `/api/invoices/[id]/replace`
- `/api/invoices/[id]/payments`, `/api/invoices/[id]/payments/[paymentId]/void`
- `/api/invoices/dues`
- `/api/reports/collections` (PB-5): JSON, or `?format=csv&section=trend|modes|clinics`

**The Billing section on `/reports`** (`src/components/reports/CollectionsSection.tsx`):
- A note: "Revenue is by visit date. Collections are by payment date."
- Five KPI tiles (Billed, Collected, Outstanding now, Discounts given, GST), using the shared `Tile` now exported from `KpiTiles.tsx`.
- Two `GrowthChart` instances, headed Billed and Collected, side by side on wide screens and stacked on a phone.
- Two `BreakdownTable`s (by payment mode, by clinic) with CSV links.

**Shared components got optional props only.** Their defaults keep the revenue report's output identical:
- `Tile`: sparkline is optional
- `BreakdownTable`: `countLabel` and `amountLabel`
- `ExportCsvLink`: `endpoint`
- `PrintButton`: `label`

`BreakdownTable`'s two numeric headers also gained `px-3` so they line up with their cells. Before that, adjacent headers ran together.

## Audit

Eleven actions under a Billing category:
- `SERVICE_ITEM_CREATED`, `SERVICE_ITEM_UPDATED`, `BILLING_SETTINGS_UPDATED`
- `INVOICE_DRAFT_CREATED`, `INVOICE_DRAFT_UPDATED`, `INVOICE_DRAFT_DISCARDED`
- `INVOICE_ISSUED`, `INVOICE_CANCELLED`, `INVOICE_REPLACEMENT_CREATED`
- `PAYMENT_RECORDED`, `PAYMENT_VOIDED`

Metadata holds ids, the number, clinic, status and amounts. It holds no demographics and no cancel or void narrative. Notifications `invoice.cancelled`, `payment.voided` and `invoice.discount_override` go to Admin/Owner and carry the number and amount only. PB-5 is read-only and writes no audit rows.

## Backfill and rollout

Follow billing PRD §9:
1. Deploy the schema and code.
2. Run `npm run billing:backfill`. It is a dry run by default and proposes role top-ups only for exact pre-billing system role snapshots.
3. Review the output, then apply with `--apply` (and `--allow-remote` for production) only after review.
4. Run `npm run verify:billing` (read-only).
5. Each clinic sets its GSTIN, prefix and price list at `/settings/billing`.

PB-5 adds no migration and no backfill.

## Verification and practical limits

PB-5 validation ran against a disposable local MariaDB 10.11 database, `127.0.0.1:3306/medcare_pb2`, set through a process-local `DATABASE_URL`.

| Check | Result |
| --- | --- |
| `npx prisma validate` | Passed |
| `npm run build` (generate + all 47 migrations + `next build --webpack`) | Passed; `/billing/[id]/print` and `/api/reports/collections` built |
| `npm run typecheck` | Passed |
| `npm run lint` | 0 errors; 5 existing warnings in untouched files |
| `npm test` (full Vitest suite) | 192 files, 3,209 tests passed |
| New unit tests | `billingPeriods` (9: IST midnight either side of a day, a month, 1 April, a year and an ISO week; window instants), `billingPrint` (5: amount in words incl. lakh/paise/zero, payments-as-of, watermark), `billingCollectionsCsv` (4) |
| `npm run test:billing` | 178 database checks passed (152 existing + 26 PB-5 collections checks) |
| `npm run verify:billing` | 6 read-only checks passed |
| `npm run test:e2e:billing` | 2 passed: the full flow at desktop 1280 px and at 375 px |
| `git diff --check` | Passed |

**What the PB-5 collections fixture covers.** It runs in its own tenant, so the totals are exact:
- Bill types:
  - a part-paid bill
  - a bill with a voided payment
  - a paid → voided → cancelled bill (its stale balance of 826.00 is asserted and then shown to be excluded)
  - its replacement
  - a second clinic
  - an unissued draft
- Boundaries at India midnight: 23:59 30 Sep / 00:01 1 Oct, both monthly and daily ("today" while UTC is still yesterday), and 23:59 31 Oct / 00:01 1 Nov.
- Figures: point-in-time outstanding, discounts and GST from ISSUED bills only, breakdowns by mode and by clinic, and the clinic filter.
- Access and isolation:
  - a clinic-scoped actor's totals
  - an out-of-scope clinic returning zeros
  - `report:read` and `invoice:read` held in different clinics
  - each permission missing on its own
  - the export gate
  - a foreign tenant
  - billing disabled, with the Revenue report still working
  - the Revenue report still summing `registrations.amount`

The raw series SQL was also run under MySQL 8's default `sql_mode` (including `ONLY_FULL_GROUP_BY`).

**What the Playwright flow covers:**
1. Create a bill from a registration, add a price-list service and a custom line, apply a 10% discount, save, review and issue.
2. Record a partial UPI payment; the dues list shows it.
3. Pay the rest: the bill is PAID and leaves the dues list.
4. Open the print page: document title, amount in words, payments as of print time, footer, no dashboard chrome, the toolbar hidden in print media, the line table fitting the A4 content width, and a PDF saved. The PrintButton calls `window.print()`.
5. Cancel is blocked while payments are active. Void both payments, then cancel with a reason.
6. The cancelled print shows the watermark and the reason.
7. Create a replacement: its draft print returns 404, and it issues with a new number.
8. On `/reports`, Billing shows ₹950.00 billed, ₹0.00 collected and ₹950.00 outstanding.
9. There is no page-level horizontal scroll at 375 px.

**Environment notes:**
- The tsx-based scripts (`test:billing`, `verify:billing`) need Node 24. On Node 20 and 22, tsx loads `@/lib/rbac` twice, so `instanceof ScopeError` fails. This is pre-existing: `test:billing` fails that way on `main` too.
- Playwright was run with a local-only `launchOptions.executablePath` override for the container's preinstalled Chromium. The committed config is unchanged.
- Under MariaDB with `ONLY_FULL_GROUP_BY`, Prisma's generated aggregate in PB-4's dues query errors. That is a MariaDB-only strictness, not seen on MySQL 8, and outside PB-5.

**Limits and follow-ups:**
- `GrowthChart` takes one series. Since the post-PB-5 hardening it accepts optional `title` and `legend` props (the defaults render the revenue chart byte-identically), and the Billing charts are titled Billed and Collected. Its tooltip still says "registrations" (the captions explain the count), and both charts share one gradient id.
- The revenue report's `reportFilterSchema` has no doctor filter, so the collections report has none either. FR-11.23's "clinic/doctor filters" is read as "the existing filters".
- The export's by-clinic file carries every per-clinic figure (billed, collected, discounts, GST, outstanding now). The on-screen by-clinic table shows collections only.
- Printed payments are ACTIVE entries only; voided entries stay visible on `/billing/[id]`.
- The `Select` `defaultValue` warning remains a separate follow-up.

## Complete file manifest

PB-1 to PB-5, excluding the unrelated WhatsApp fix merged in between ([#27](https://github.com/pv-webservices/medcare-pro/pull/27)). The stages that touched each file are in brackets.

Added files (88):

- `docs/patient-billing-handoff-prompts.md` (PB-1)
- `docs/patient-billing-implementation-report.md` (PB-5)
- `docs/patient-billing-prd.md` (PB-1)
- `playwright.billing.config.ts` (PB-5)
- `prisma/migrations/20260927211833_patient_billing/migration.sql` (PB-1)
- `scripts/backfill-billing.mts` (PB-1)
- `scripts/billing-test-fixture.ts` (PB-5)
- `scripts/test-billing-collections.mts` (PB-5)
- `scripts/test-billing-concurrency.mts` (PB-3)
- `scripts/test-billing-invoices.mts` (PB-3, PB-4)
- `scripts/test-billing-payments-concurrency.mts` (PB-4)
- `scripts/test-billing-payments.mts` (PB-4)
- `scripts/test-billing.mts` (PB-2, PB-3, PB-4, PB-5)
- `scripts/verify-billing.mts` (PB-1)
- `src/app/(dashboard)/billing/[id]/page.tsx` (PB-3, PB-4, PB-5)
- `src/app/(dashboard)/billing/dues/page.tsx` (PB-4)
- `src/app/(dashboard)/billing/page.tsx` (PB-3, PB-4)
- `src/app/(dashboard)/registration/[id]/bill/page.tsx` (PB-3)
- `src/app/(dashboard)/settings/billing/page.tsx` (PB-2)
- `src/app/(invoice-print)/billing/[id]/print/page.tsx` (PB-5)
- `src/app/(invoice-print)/billing/[id]/print/print.css` (PB-5)
- `src/app/api/billing/services/[id]/route.ts` (PB-2)
- `src/app/api/billing/services/route.ts` (PB-2)
- `src/app/api/billing/settings/[clinicId]/route.ts` (PB-2)
- `src/app/api/invoices/[id]/cancel/route.ts` (PB-4)
- `src/app/api/invoices/[id]/discard/route.ts` (PB-3)
- `src/app/api/invoices/[id]/issue/route.ts` (PB-3)
- `src/app/api/invoices/[id]/payments/[paymentId]/void/route.ts` (PB-4)
- `src/app/api/invoices/[id]/payments/route.ts` (PB-4)
- `src/app/api/invoices/[id]/replace/route.ts` (PB-4)
- `src/app/api/invoices/[id]/route.ts` (PB-3)
- `src/app/api/invoices/dues/route.ts` (PB-4)
- `src/app/api/invoices/route.ts` (PB-3)
- `src/app/api/registrations/[id]/invoice/route.ts` (PB-3)
- `src/app/api/reports/collections/route.ts` (PB-5)
- `src/components/billing/BillingSettingsForm.tsx` (PB-2)
- `src/components/billing/DuesTable.tsx` (PB-4)
- `src/components/billing/InvoiceActions.tsx` (PB-4)
- `src/components/billing/InvoiceDocument.tsx` (PB-3, PB-5)
- `src/components/billing/InvoiceEditor.tsx` (PB-3)
- `src/components/billing/InvoiceLineBuilder.tsx` (PB-3)
- `src/components/billing/PaymentList.tsx` (PB-4)
- `src/components/billing/ReasonModal.tsx` (PB-4)
- `src/components/billing/RecordPaymentForm.tsx` (PB-4)
- `src/components/billing/ServiceItemForm.tsx` (PB-2)
- `src/components/billing/ServiceItemList.tsx` (PB-2)
- `src/components/billing/VoidPaymentButton.tsx` (PB-4)
- `src/components/billing/billingRequest.ts` (PB-4)
- `src/components/reports/CollectionsSection.tsx` (PB-5)
- `src/lib/billing/amountInWords.ts` (PB-1)
- `src/lib/billing/billingAccess.ts` (PB-2)
- `src/lib/billing/billingApi.ts` (PB-2)
- `src/lib/billing/billingLabels.ts` (PB-4)
- `src/lib/billing/billingPages.ts` (PB-3)
- `src/lib/billing/billingPeriods.ts` (PB-5)
- `src/lib/billing/billingSettings.ts` (PB-2)
- `src/lib/billing/billingValidation.ts` (PB-2, PB-3)
- `src/lib/billing/collectionsCsv.ts` (PB-5)
- `src/lib/billing/collectionsReport.ts` (PB-5)
- `src/lib/billing/dues.ts` (PB-4)
- `src/lib/billing/duesAge.ts` (PB-4)
- `src/lib/billing/duesCsv.ts` (PB-4)
- `src/lib/billing/financialYear.ts` (PB-1)
- `src/lib/billing/gstin.ts` (PB-1)
- `src/lib/billing/invoiceDetail.ts` (PB-4, PB-5)
- `src/lib/billing/invoiceMath.ts` (PB-1, PB-3)
- `src/lib/billing/invoiceNumber.ts` (PB-1)
- `src/lib/billing/invoiceValidation.ts` (PB-3, PB-4)
- `src/lib/billing/invoices.ts` (PB-3, PB-4)
- `src/lib/billing/payments.ts` (PB-4)
- `src/lib/billing/serviceItems.ts` (PB-2, PB-3)
- `src/lib/billingRoleMigration.ts` (PB-1)
- `src/lib/preBillingRoles.json` (PB-1)
- `src/lib/registrationAmountPayload.ts` (PB-3)
- `src/lib/visitTypes.ts` (PB-3)
- `tests/e2e/billing.spec.ts` (PB-5)
- `tests/unit/billingCollectionsCsv.test.ts` (PB-5)
- `tests/unit/billingFoundation.test.ts` (PB-1, PB-2, PB-3, PB-4)
- `tests/unit/billingGstinNormalization.test.ts` (PB-3)
- `tests/unit/billingInvoiceRoutes.test.ts` (PB-3)
- `tests/unit/billingInvoiceValidation.test.ts` (PB-3)
- `tests/unit/billingPayments.test.ts` (PB-4)
- `tests/unit/billingPeriods.test.ts` (PB-5)
- `tests/unit/billingPrint.test.ts` (PB-5)
- `tests/unit/billingTransactionClient.test.ts` (PB-3)
- `tests/unit/billingValidation.test.ts` (PB-2)
- `tests/unit/registrationAmountPayload.test.ts` (PB-3)
- `tests/unit/registrationBillingAmount.test.ts` (PB-3)

Modified existing files (29):

- `docs/PRD.md` (PB-1, PB-5)
- `package.json` (PB-1, PB-2, PB-3, PB-5)
- `prisma/schema.prisma` (PB-1)
- `scripts/verify-roles.mts` (PB-2, PB-3)
- `src/app/(dashboard)/registration/[id]/page.tsx` (PB-3, PB-4)
- `src/app/(dashboard)/reports/page.tsx` (PB-5)
- `src/components/prescriptions/PrintButton.tsx` (PB-5)
- `src/components/registration/PatientVisits.tsx` (PB-3)
- `src/components/registration/RegistrationDetail.tsx` (PB-3)
- `src/components/registration/RegistrationForm.tsx` (PB-3)
- `src/components/reports/BreakdownTable.tsx` (PB-5)
- `src/components/reports/ExportCsvLink.tsx` (PB-5)
- `src/components/reports/KpiTiles.tsx` (PB-5)
- `src/lib/audit.ts` (PB-1)
- `src/lib/auditDescriptions.ts` (PB-1)
- `src/lib/defaultFeatures.ts` (PB-1)
- `src/lib/defaultRoles.ts` (PB-1)
- `src/lib/moduleFeatures.ts` (PB-1)
- `src/lib/navigation.ts` (PB-3)
- `src/lib/notifications.ts` (PB-1, PB-4)
- `src/lib/permissions.ts` (PB-1, PB-2, PB-3, PB-4)
- `src/lib/rbac.ts` (PB-3)
- `src/lib/registrations.ts` (PB-3)
- `src/lib/reports.ts` (PB-5)
- `src/lib/settingsSections.ts` (PB-2)
- `src/middleware.ts` (PB-3)
- `tests/unit/appointmentPermissionDefaults.test.ts` (PB-1)
- `tests/unit/auditDescriptions.test.ts` (PB-1)
- `tests/unit/defaultRoles.test.ts` (PB-1)
