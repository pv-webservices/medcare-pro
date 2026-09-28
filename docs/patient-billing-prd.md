# Patient Billing — PRD (v1 draft)

| | |
|---|---|
| **Module** | Patient Billing (PRD §6.11, FR-11.x) |
| **Status** | Draft v1, ready for staged build (PB-1 → PB-5) |
| **Owner** | Sitecraf (Pramod Verma) |
| **Written against** | `main` @ `ddaaaae` (28 Sep 2026) |
| **Feature key** | `billing` (CORE, Standard plan) |

> **Note to AI agents:** this document is the source of truth for the billing
> module. `CLAUDE.md` says "follow the PRD exactly". This file *is* that PRD
> for billing, and PB-1 copies its summary into `docs/PRD.md`. If this document
> and the code disagree, or it is silent on something you need, **stop and
> ask**. Do not guess.

---

## 1. Purpose

Clinics currently record one number per visit, `registrations.amount`. They
cannot show a patient an itemised bill, take part-payment, see who still owes
money, or print a receipt with their own branding. Patient Billing adds these
without breaking the revenue reports built on `registrations.amount`.

**v1 scope:** a clinic-level service price list, itemised invoices per visit,
optional GST, manual payment recording (cash, UPI, card, bank transfer)
including part-payments, a dues list, printable invoices, and a
Billed/Collected/Outstanding report.

## 2. Decisions already made

| # | Decision | Why |
|---|---|---|
| D1 | **One live invoice per visit (Registration).** | Matches how clinics work: one bill per visit. Enforced by a nullable unique `active_key`, the same pattern prescriptions use. |
| D2 | **Itemised lines** (consultation + procedures + tests). | Most small and medium clinics bill this way. A flat fee is just a one-line invoice. |
| D3 | **Part-payments and dues are in v1.** | Confirmed requirement. |
| D4 | **GST fields exist, default 0%.** GSTIN is set per clinic and the tax rate per service. | Most healthcare services are exempt. A clinic must confirm its rates with its CA. **The app makes no GST-compliance claim.** |
| D5 | **No payment gateway in v1.** Payments are recorded by hand. | No new vendor or dependency. Razorpay links and UPI QR come in a later phase. |
| D6 | **Issued invoices are immutable.** Mistakes are fixed by cancel + replacement. | Same principle as issued prescriptions, and standard billing practice. |
| D7 | **Sequential invoice numbers per clinic, per Indian financial year**, assigned only at issue. | GST practice expects a consecutive serial within a financial year, max 16 characters. This is a deliberate difference from the UUID-based `RX-` numbers. |
| D8 | **`registrations.amount` stays the revenue source for the existing reports** and is kept equal to the live invoice's grand total. | Revenue Reports, the dashboard and CSV export all sum this column (`src/lib/reports.ts`, `src/lib/adminDashboard.ts`). Syncing it means none of them need rewriting. |
| D9 | **No invoice backfill for historical visits.** | Numbering past visits would create invoice serials dated in the past. Old visits stay amount-only and show as "Not billed". |
| D10 | **Delivery is print / browser "Save as PDF" only in v1.** | `patients` has no email column, and WhatsApp (RkvRobo) is still blocked. Same approach as prescription print: no server-side PDF infrastructure. |
| D11 | **Tax is added on top of the price** (prices are exclusive of GST). | Standard invoice arithmetic. With the default 0% it has no effect. |
| D12 | **Intra-state supply only: tax is split CGST + SGST.** IGST is out of scope. | Patients receive the service at the clinic, so the place of supply is the clinic's state. |

## 3. Roles and permissions

New permission strings (add to `src/lib/permissions.ts` as a **"Billing"** group):

| Key | Label | Allows |
|---|---|---|
| `invoice:read` | View bills | See invoices, payments and dues in permitted clinics |
| `invoice:create` | Prepare and issue bills | Create/edit draft invoices, issue them, discard own drafts, create a replacement after cancellation |
| `payment:record` | Record payments | Record a payment against an issued invoice |
| `invoice:discount:override` | Approve large discounts | Issue an invoice whose discount exceeds the clinic's staff discount limit |
| `invoice:cancel` | Cancel bills and void payments | Cancel an issued invoice (reason required); void a payment entered by mistake (reason required) |
| `billing:settings:manage` | Manage billing settings | Edit the service price list and clinic billing settings (GSTIN, prefix, discount limit, footer) |

Default grants for new tenants in `src/lib/defaultRoles.ts`, and the role top-ups
applied by the PB-1 backfill:

| Role key | Grants |
|---|---|
| `OWNER` | `*` (unchanged) |
| `CLINIC_ADMIN` | all six |
| `RECEPTIONIST` | `invoice:read`, `invoice:create`, `payment:record` |
| `STAFF` | `invoice:read` |
| `DOCTOR` | `invoice:read` |

Permission scope is resolved by the existing clinic RBAC helpers
(`src/lib/rbac.ts`, `src/lib/clinicScope.ts`). Cross-tenant and out-of-clinic
IDs return the same not-found response as other modules.

**Entitlement:** a new feature `billing` in `src/lib/defaultFeatures.ts` (CORE,
`globalEnabled: true`, `inDefaultPlan: true`) is mapped in
`src/lib/moduleFeatures.ts`. Entitlement and permission are both enforced. If
the feature configuration is missing, access fails closed. **When `billing` is
not enabled for a tenant, registrations behave exactly as they do today.**

## 4. Functional requirements

### 4.1 Billing settings (per clinic)
- **FR-11.1**: Users with `billing:settings:manage` can set, per clinic:
  - GSTIN: optional, 15 characters, format-validated
  - legal/trade name for the invoice: optional; the clinic name is used if blank
  - invoice prefix: 1–4 uppercase letters or digits, default `INV`
  - staff discount limit: a % of the invoice subtotal, 0–100, **default 0**
  - invoice footer note: optional, max 500 characters
- **FR-11.2**: Changing the prefix affects only invoices issued afterwards.
  Issued numbers never change.

### 4.2 Service price list
- **FR-11.3**: Users with `billing:settings:manage` maintain service items:
  - name
  - category: `CONSULTATION`, `PROCEDURE`, `TEST` or `OTHER`
  - price: ₹, 2 decimals, **no default**
  - GST rate %: 0–40, 2 decimals, default 0
  - optional SAC code: digits, max 8
  - scope: all clinics (tenant-wide) or one clinic
- **FR-11.4**: Items are retired with `isActive = false`, never deleted.
  Invoice lines keep a reference to them.
- **FR-11.5**: Duplicate names within the same scope are rejected in
  application code before insert. MySQL treats NULLs as distinct in unique
  indexes, as the `AppointmentType` notes warn.
- **FR-11.6**: A clinic without a GSTIN cannot save a service with a non-zero
  GST rate *for that clinic*. A tenant-wide taxed item can be used at a clinic
  only if that clinic has a GSTIN. This is re-checked when an invoice is issued.

### 4.3 Invoices
- **FR-11.7**: On a registration detail page, a user with `invoice:create` sees
  **Create bill** when there is no live invoice. The page instead shows
  **Continue bill** for a draft, or **View bill** with a payment status badge
  for an issued invoice.
- **FR-11.8**: A new draft is pre-filled with one `CONSULTATION` line: the
  description is "Consultation", quantity 1, and the unit price is the
  registration's `amount`. The line is added only when that amount is > 0.
  This carries a booked appointment's fee onto the bill, because conversion
  already copies it to `registrations.amount`.
- **FR-11.9**: A draft can be edited freely:
  - lines can be added from the active service list for that clinic, or as
    free-text custom lines
  - quantity is a whole number from 1 to 999
  - unit price, GST rate and SAC code are copied from the service at the moment
    the line is added, and can be edited on the draft
  - each line can take a discount in ₹; the UI may accept a % and convert it
  - the whole line set is replaced atomically on each save
  - every save increments `revision`, and a stale revision returns 409
- **FR-11.10**: **Issue** requires all of the following:
  - at least one line
  - every line's discount ≤ its gross amount
  - grand total ≥ 0. A zero-total invoice is allowed and becomes `PAID` at once.
  - no taxed line unless the clinic has a GSTIN
  - if total discount ÷ subtotal exceeds the clinic's staff discount limit, the
    issuer must hold `invoice:discount:override`

  In one transaction, issuing:
  - locks the registration row first
  - reloads ownership from the database
  - allocates the next number
  - sets the document type
  - freezes the snapshot
  - sets `registrations.amount` to the grand total, writing a
    `registration_edit_log` row if the value changed
  - writes the audit entry
- **FR-11.11**: Number format: `{PREFIX}-{FY}-{SEQ}`, e.g. `INV-2627-00001`.
  - `FY` is the two-digit start year followed by the two-digit end year of the
    Indian financial year (1 April – 31 March), taken from the issue instant in
    India time.
  - `SEQ` is 5 digits, zero-padded, per clinic per FY, starting at 1. It comes
    from a locked counter row, so there are no gaps from drafts and no
    duplicates under concurrency.
  - The full number is at most 15 characters.
  - The database guarantees uniqueness on (`clinic_id`, `invoice_number`).
- **FR-11.12**: Document type is fixed at issue:
  - `INVOICE` when the clinic has no GSTIN
  - `TAX_INVOICE` when it has a GSTIN and any line is taxed
  - `BILL_OF_SUPPLY` when it has a GSTIN and every line is at 0%
- **FR-11.13**: The issue snapshot (JSON) freezes:
  - clinic name, legal name, address, city, logo value, GSTIN and footer note
  - patient code, name, age, gender, mobile and city
  - doctor name and department
  - visit date and type
  - every line and all totals
  - number, document type and issue instant

  The detail page and print always render from the snapshot, so later profile
  edits never rewrite an issued bill.
- **FR-11.14**: Issued invoices have **no content update or delete endpoint**.
  Registration edits cannot change `amount` while a live issued invoice exists:
  `updateRegistration` returns 409 with "This visit has been billed — change
  the bill instead." Other registration fields stay editable.
- **FR-11.15**: A draft can be **discarded** by its creator, or by anyone with
  `invoice:cancel`. It moves to `CANCELLED` with no number. This is audited but
  sends no notification.

### 4.4 Payments and dues
- **FR-11.16**: A user with `payment:record` records a payment against an
  `ISSUED` invoice:
  - amount > 0 and ≤ the current balance due. Overpayment and advance payments
    are out of scope in v1.
  - mode: `CASH`, `UPI`, `CARD`, `BANK_TRANSFER` or `OTHER`
  - optional reference (e.g. UPI transaction ID), max 100 characters
  - received date and time, defaulting to now

  Each payment updates `amount_paid`, `balance_due` and `payment_status`
  (`UNPAID`, `PARTIAL`, `PAID`) in the same transaction, with the invoice row
  locked.
- **FR-11.17**: **Void payment** requires `invoice:cancel` and a reason of 3–500
  characters. The payment row is kept with status `VOIDED`, and the invoice
  totals are recalculated. This corrects a mistaken entry. Refunds are a later
  phase.
- **FR-11.18**: **Dues list** (`/billing/dues`) shows issued invoices with
  `balance_due > 0` in the actor's clinics. It is:
  - filterable by clinic, age bucket (0–7, 8–30, 31+ days since issue) and
    doctor
  - searchable by patient name, mobile, patient code or invoice number
  - totalled at the top
  - exportable as CSV

  Each row links to the invoice, where a payment can be recorded.

### 4.5 Cancellation and replacement
- **FR-11.19**: **Cancel** requires `invoice:cancel`, a confirmation modal and a
  reason of 3–500 characters. It is allowed only on an `ISSUED` invoice with
  **no ACTIVE payments**, so any payments must be voided first. The number,
  snapshot and issue metadata are kept. `active_key` is set to NULL.
  `registrations.amount` is set to 0, with an edit-log row. A notification is
  sent.
- **FR-11.20**: After cancellation, **Create replacement** (`invoice:create`)
  opens a new draft for the same visit. The cancelled invoice's lines are cloned
  and `replaces_invoice_id` is set. Only one replacement per cancelled invoice
  is allowed (unique).

### 4.6 Listing, print and reports
- **FR-11.21**: `/billing` lists invoices, with server-side pagination:
  - filters: clinic, status, payment status, doctor, issue-date range
  - search: patient name, mobile, patient code or invoice number
- **FR-11.22**: **Print** (`/billing/[id]/print`, a separate route group
  outside the dashboard layout, like prescription print):
  - A4 layout using `@page` CSS
  - clinic branding and GSTIN, document-type title, number and date
  - patient and visit block
  - line table with columns # / Description / SAC / Qty / Rate / Discount /
    Taxable / GST% / Amount
  - totals: subtotal, discount, taxable, CGST, SGST, **Grand total**
  - **amount in words** in Indian numbering, e.g. "Rupees One Lakh Twenty
    Thousand Only"
  - payments table and balance due
  - footer note and "computer-generated" line

  Drafts return not-found. Cancelled invoices print with a clear "CANCELLED"
  watermark. Printing uses `window.print()`.
- **FR-11.23**: **Collections report** is a new "Billing" section on
  `/reports`, gated by `report:read` **and** `invoice:read`. It uses the
  existing `reportPeriods` and clinic/doctor filters, and shows:
  - **Billed**: sum of grand totals of issued invoices by issue date. Cancelled
    invoices are excluded.
  - **Collected**: sum of ACTIVE payments by received date
  - **Outstanding**: current sum of `balance_due`, which is point-in-time rather
    than period-bound
  - **Discounts given**
  - **GST** (CGST + SGST)
  - breakdown by payment mode and by clinic, with CSV export via
    `reports:export`

  The existing Revenue report is **unchanged**. It stays revenue by visit date
  from `registrations.amount`. The UI labels the difference: "Revenue is by
  visit date. Collections are by payment date."
- **FR-11.24**: **Notifications** go to Admin/Owner via the existing feed, with
  new types `invoice.cancelled`, `payment.voided` and `invoice.discount_override`.
  Normal issue and payment events are **audited but not notified**, to avoid
  noise.

## 5. Data model

All money columns are `Decimal(10, 2)`. All arithmetic is done in integer paise
in one pure module, never with floats. Every clinic-scoped table carries
`tenant_id` and `clinic_id`, denormalised like `patients` and `appointments`.

### `clinic_billing_settings`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `tenant_id`, `clinic_id` | FK | `clinic_id` **unique**. The row is created lazily on first save; if absent, defaults apply. |
| `gstin` | VarChar(15)? | Format-validated |
| `legal_name` | VarChar(200)? | |
| `invoice_prefix` | VarChar(4) | default `INV` |
| `staff_discount_limit_percent` | Decimal(5,2) | default 0 |
| `footer_note` | Text? | ≤ 500 characters, enforced in app |
| `created_at`, `updated_at` | | |

### `service_items`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `tenant_id` | FK | |
| `clinic_id` | FK? | NULL = every clinic under the tenant |
| `name` | VarChar(120) | `@@unique([tenant_id, clinic_id, name])` plus an app-level duplicate check |
| `category` | enum `ServiceCategory` | CONSULTATION, PROCEDURE, TEST, OTHER |
| `price` | Decimal(10,2) | **no DB default** |
| `tax_rate_percent` | Decimal(5,2) | default 0 |
| `sac_code` | VarChar(8)? | |
| `is_active` | Boolean | default true |
| `created_at`, `updated_at` | | |

### `invoices`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `tenant_id`, `clinic_id`, `registration_id`, `patient_id` | FK, **Restrict** | Derived from the registration and never from the request body |
| `doctor_id` | FK?, Restrict | Copied from the registration at draft creation |
| `status` | enum `InvoiceStatus` | DRAFT, ISSUED, CANCELLED |
| `active_key` | VarChar(30)? **unique** | = `registration_id` while DRAFT/ISSUED, NULL when CANCELLED. This enforces D1. |
| `invoice_number` | VarChar(16)? | Set at issue. `@@unique([clinic_id, invoice_number])` |
| `financial_year` | VarChar(4)? | e.g. `2627` |
| `document_type` | enum `InvoiceDocumentType`? | INVOICE, TAX_INVOICE, BILL_OF_SUPPLY. Set at issue. |
| `subtotal`, `discount_total`, `taxable_total`, `cgst_total`, `sgst_total`, `grand_total` | Decimal | Recomputed on every draft save |
| `amount_paid`, `balance_due` | Decimal | Maintained by the payment service |
| `payment_status` | enum `InvoicePaymentStatus` | UNPAID, PARTIAL, PAID |
| `revision` | Int | Optimistic lock for draft saves |
| `snapshot` | Json? | Frozen at issue (FR-11.13) |
| `issued_at`, `issued_by_id` | | |
| `cancelled_at`, `cancelled_by_id`, `cancel_reason` | | |
| `replaces_invoice_id` | FK? **unique** | One replacement per cancelled invoice |
| `created_by_id`, `created_at`, `updated_at` | | |

Indexes: `[clinic_id, status, issued_at]`, `[clinic_id, payment_status]`,
`[patient_id]`, `[doctor_id]`, `[registration_id]`.

### `invoice_lines`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `invoice_id` | FK, Cascade | Lines are only ever replaced while the invoice is DRAFT |
| `position` | Int | `@@unique([invoice_id, position])` |
| `service_item_id` | FK?, Restrict | NULL = custom line |
| `description` | VarChar(200) | |
| `category` | enum `ServiceCategory` | |
| `quantity` | Int | 1–999 |
| `unit_price`, `discount_amount`, `tax_rate_percent` | Decimal | |
| `sac_code` | VarChar(8)? | |
| `taxable_amount`, `tax_amount`, `line_total` | Decimal | Computed by the server |

### `invoice_payments`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `tenant_id`, `clinic_id`, `invoice_id` | FK, Restrict | |
| `amount` | Decimal | > 0 |
| `mode` | enum `PaymentMode` | CASH, UPI, CARD, BANK_TRANSFER, OTHER |
| `reference` | VarChar(100)? | |
| `received_at` | DateTime | An **instant**, displayed in India time (same convention as prescription `issued_at`) |
| `recorded_by_id` | FK | |
| `status` | enum `PaymentEntryStatus` | ACTIVE, VOIDED |
| `voided_at`, `voided_by_id`, `void_reason` | | |
| `created_at` | | |

Indexes: `[clinic_id, received_at]`, `[invoice_id]`.

### `invoice_number_sequences`
| Column | Type | Notes |
|---|---|---|
| `clinic_id` | FK | `@@id([clinic_id, financial_year])` |
| `financial_year` | VarChar(4) | |
| `last_number` | Int | Incremented under `SELECT … FOR UPDATE` inside the issue transaction |

**No columns are added to `registrations`, `appointments` or `appointment_types`.**
Registration, Patient, Clinic and Doctor get back-relations only.

### Arithmetic (all in paise, in `src/lib/billing/invoiceMath.ts`)
```
gross        = quantity × unit_price
taxable      = gross − discount_amount                (discount ≤ gross)
tax          = round_half_up(taxable × rate / 100)     per line
cgst         = floor(tax / 2);  sgst = tax − cgst      per line, then summed
line_total   = taxable + tax
subtotal     = Σ gross;   discount_total = Σ discount
taxable_total= Σ taxable; grand_total = taxable_total + cgst_total + sgst_total
discount %   = discount_total / subtotal × 100         (0 when subtotal is 0)
```
No round-off to the nearest rupee in v1.

## 6. Routes

**Pages**
- `/registration/[id]/bill`: the draft editor. It mirrors `/registration/[id]/consultation`.
- `/billing`: invoice list (FR-11.21)
- `/billing/[id]`: detail, payments and actions
- `/billing/dues`: dues list (FR-11.18)
- `/billing/[id]/print`: in a new route group `src/app/(invoice-print)/`
- `/settings/billing`: clinic billing settings and price list. Added to
  `src/lib/settingsSections.ts`, with view `invoice:read` and manage
  `billing:settings:manage`.

**API** (every handler goes through `src/lib/apiHandler.ts` conventions and uses
strict Zod bodies)
- `GET/POST /api/billing/services`, `PATCH /api/billing/services/[id]`
- `GET/PUT /api/billing/settings/[clinicId]`
- `GET/POST /api/registrations/[id]/invoice`: get the live invoice / create a draft
- `GET /api/invoices`, `GET /api/invoices/[id]`, `PUT /api/invoices/[id]` (save draft with `revision`)
- `POST /api/invoices/[id]/issue` | `/cancel` | `/discard` | `/replace`
- `POST /api/invoices/[id]/payments`, `POST /api/invoices/[id]/payments/[paymentId]/void`
- `GET /api/invoices/dues` (+ `?format=csv`)
- `GET /api/reports/collections` (+ export)

Responses from the billing API use `Cache-Control: private, no-store`, like the
prescription API.

## 7. Audit

New `AUDIT_ACTIONS` in `src/lib/audit.ts`, with a **Billing** category and
entries in `src/lib/auditDescriptions.ts`:
`SERVICE_ITEM_CREATED`, `SERVICE_ITEM_UPDATED`, `BILLING_SETTINGS_UPDATED`,
`INVOICE_DRAFT_CREATED`, `INVOICE_DRAFT_UPDATED`, `INVOICE_DRAFT_DISCARDED`,
`INVOICE_ISSUED`, `INVOICE_CANCELLED`, `INVOICE_REPLACEMENT_CREATED`,
`PAYMENT_RECORDED`, `PAYMENT_VOIDED`.

Metadata holds IDs, the invoice number, clinic, status and amounts. It holds
**no** patient demographics and no cancellation or void narrative; the reason
stays on the record itself. Explicit saves are audited; keystrokes are not.

## 8. Out of scope (v1)

- Online payments (Razorpay links, UPI QR)
- Refunds and credit notes
- Advance deposits and overpayment credit
- IGST / inter-state supply
- Rounding to the nearest rupee
- Thermal (80 mm) receipts
- Email and WhatsApp delivery
- Patient-portal bill view
- Pharmacy / medicine billing from prescriptions
- Doctor commission / revenue share
- Insurance / TPA
- Package or membership pricing
- Invoice backfill for historical visits
- Server-side PDF generation

## 9. Rollout

1. Deploy schema and code (migration `YYYYMMDDHHMMSS_patient_billing`).
2. Run `npm run billing:backfill`. It is a dry run by default. It installs the
   `billing` feature and the Standard-plan link if absent, and proposes role
   top-ups only for exact, unmodified pre-billing system role snapshots
   (`src/lib/preBillingRoles.json`). Customised roles are left alone.
3. Review the output, then apply with `--apply` (and `--allow-remote` for
   production).
4. Run `npm run verify:billing` (read-only).
5. Each clinic Owner/Admin sets a GSTIN (if registered) and the prefix at
   `/settings/billing`, then builds the price list.

## 10. Changes to `docs/PRD.md` (applied in PB-1)

- §5 In Scope: add "Patient billing: service price list, itemised invoices,
  optional GST, manual payments with part-payment and dues, printable invoices,
  collections report (§6.11)."
- §6: add **6.11 Patient Billing**, a short summary of FR-11.1–FR-11.24 that
  links to `docs/patient-billing-prd.md`.
- §7: add rows for `clinic_billing_settings`, `service_items`, `invoices`,
  `invoice_lines`, `invoice_payments` and `invoice_number_sequences`, marked
  "Built (PB-1)" once merged.
- §10: add "GST treatment is configured by each clinic with its CA; the
  application performs arithmetic only and makes no compliance claim." Also
  add "Registrations.amount mirrors the live invoice total once billed (D8)."