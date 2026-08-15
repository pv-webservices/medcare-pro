# Product Requirements Document (PRD) — v2
## MEDCARE PRO

| | |
|---|---|
| **Version** | 2.0 |
| **Supersedes** | v1.0 (separate-deployment-per-clinic model — deprecated) |
| **Owner** | Sitecraf (Pramod Verma) |
| **Purpose** | Reference document for AI coding agents (Claude, Gemini) building this project in Antigravity IDE |

> **Note to AI agents:** This is the current source of truth. If you have context from
> an earlier version of this PRD or the old `prisma-multitenant-mysql` skill, discard
> it — the multi-tenancy model changed. There is no more "one deployment per clinic."

## Changelog from v1.0

- **Architecture**: single shared platform + single database (was: isolated DB/deployment per clinic)
- **Auth**: self-signup with email verification (was: admin manually provisioned per clinic, no signup)
- **New modules**: Doctors, Clinics, Roles/Permissions, Revenue Reports, Notifications, Admin theming
- **Patient records**: expanded fields + formatted Patient ID + edit audit trail
- **IVR**: deprioritized, out of MVP scope
- **WhatsApp**: via a third-party BSP (provider TBD), not direct Meta Cloud API

---

## 1. Product Overview

A multi-clinic SaaS platform. One account (a business/owner) signs up once and can
manage multiple clinics under that single login — each clinic has its own doctors,
patients, and revenue tracking, but all live in one shared application and database,
scoped by `clinicId`.

## 2. Problem Statement

1. Clinics track patients and revenue manually, with no shared system across multiple
   locations under the same owner.
2. There's no audit trail — anyone can edit a patient record with no accountability.
3. Owners running more than one clinic have no consolidated view of performance
   across locations or doctors.
4. Patient communication (reminders, updates) is inconsistent.

## 3. Goals

- One login gives an account owner visibility and control across all their clinics.
- Every record edit is attributable and visible to admins (transparency, not silent edits).
- Revenue and growth are viewable at a glance — by clinic, by doctor, by time period.
- Role-based access so staff only see/do what their role permits.

## 4. Users & Roles

| Role | Scope | Capabilities |
|---|---|---|
| **Owner/Super Admin** | Account-wide | Everything — manage clinics, doctors, patients, roles, theme/branding, sees all edit history |
| **Admin** | Account-wide or clinic-scoped (assignable) | Manage patients/doctors/registrations for assigned scope, sees edit history for their scope |
| **Staff/Receptionist** | Single clinic | Create/view patient registrations, cannot see edit history, cannot manage doctors/clinics/roles |

Roles are custom and assignable per user — the three above are the default seed set,
not a hardcoded enum the UI locks to.

## 5. Scope

### In Scope (MVP)
- Signup (email + password + business name) with email verification gate before login
- Multi-clinic management under one account
- Patient registration: full field set, search, filter, export, edit audit trail
- Doctors: CRUD, availability calendar, optional leave tracking
- Clinics: CRUD (name, address, city, branding)
- Revenue reports: daily/weekly/monthly/yearly, filterable by clinic and doctor, with KPIs and a growth graph
- Notifications on record modification
- Role creation and assignment (Owner/Admin/Staff seed roles, extensible)
- Admin settings: theme customization, logo upload
- WhatsApp messaging via a third-party BSP (provider integration TBD)

### Out of Scope (MVP) — Future Roadmap
- IVR / after-hours smart receptionist (deprioritized, revisit post-MVP)
- Native mobile app
- Patient self-service booking portal

---

## 6. Functional Requirements

### 6.1 Signup & Authentication
- **FR-1.1**: User signs up with Business/Clinic Name, Email, Password.
- **FR-1.2**: Account is inactive until email is verified (verification link sent to the provided email).
- **FR-1.3**: After verification, user is redirected to `/login`.
- **FR-1.4**: On login, browser autofill works normally (correct `autocomplete` attributes on email/password fields — no custom JS blocking it).
- **FR-1.5**: Unverified accounts attempting login see a clear "please verify your email" message with a resend option.

### 6.2 Clinics Module
- **FR-2.1**: Owner/Admin can create additional clinics under their account (name, address, city, branding).
- **FR-2.2**: Clinic list view shows all clinics under the account with key stats (patient count, doctor count).
- **FR-2.3**: Every other module (patients, doctors, reports) is filterable/scoped by clinic.

### 6.3 Patient Registration
- **FR-3.1**: New registration form: auto-generated Patient ID (`PT-YYYY-####`, sequential), Patient Name, Age, Gender, Mobile Number, Amount, Address (with City), Doctor (select), Department (**required**).
- **FR-3.2**: Registration list is searchable by patient name or phone number.
- **FR-3.3**: Registration list supports filtering (by clinic, doctor, department, date range).
- **FR-3.4**: Registrations can be exported (CSV at minimum).
- **FR-3.5**: Registration records are editable.
- **FR-3.6**: Every edit is logged: who (role + user), when (date/time), what changed. Edit history is visible **only to Admin/Owner roles** — Staff cannot see it.
- **Acceptance criteria**: Editing a record never silently overwrites without a log entry; Staff role can edit but the edit still gets logged and is just not visible to them afterward.

### 6.4 Doctors Module
- **FR-4.1**: Dashboard shows total doctor count, filterable by clinic.
- **FR-4.2**: Admin can add a doctor: Name, Department, Gender, Age, Phone (optional), Clinic Location (which clinic they belong to).
- **FR-4.3**: Doctor availability is calendar-based — specific dates and time ranges.
- **FR-4.4**: Optional leave form — date range + optional reason, marks the doctor unavailable for that period.

### 6.5 Clinic Module
- Follows the same structural pattern as Doctors: list, add/edit form, and detail view scoped to the account.

### 6.6 Revenue Report
- **FR-6.1**: Revenue totals selectable by period: Daily, Weekly, Monthly, Yearly.
- **FR-6.2**: KPI metrics displayed (e.g. total revenue, total registrations, average revenue per patient) for the selected period.
- **FR-6.3**: Growth graph showing the trend over the selected period.
- **FR-6.4**: Report is breakable down by clinic and by doctor — not just an account-wide total.

### 6.7 Notifications
- **FR-7.1**: Any modification to a patient/doctor/clinic record generates a notification visible to Admin/Owner roles.
- **FR-7.2**: Notifications are marked read/unread.

### 6.8 Admin Settings (Owner/Admin only)
- **FR-8.1**: Create custom roles and assign granular permissions.
- **FR-8.2**: Assign roles to users, optionally scoped to a specific clinic.
- **FR-8.3**: Upload/change the account's logo.
- **FR-8.4**: Customize theme (at minimum: primary brand color).

### 6.9 WhatsApp Messaging
- **FR-9.1**: Send template messages to patients via the third-party BSP's API (provider and credentials TBD — see Assumptions).
- **FR-9.2**: Delivery status logged and visible against the message.

---

## 7. Data Model

| Table | Key Fields | Notes |
|---|---|---|
| `accounts` | `id`, `business_name`, `email`, `password_hash`, `email_verified_at`, `created_at` | Top-level tenant — one signup = one account |
| `users` | `id`, `account_id` (FK), `name`, `email`, `password_hash`, `created_at` | A login within an account (owner, admin, or staff) |
| `roles` | `id`, `account_id` (FK), `name`, `permissions` (JSON) | Custom, extensible; seed with Owner/Admin/Staff |
| `user_roles` | `user_id` (FK), `role_id` (FK), `clinic_id` (FK, nullable) | Null `clinic_id` = account-wide scope |
| `clinics` | `id`, `account_id` (FK), `name`, `address`, `city`, `logo_url`, `theme_color` | A clinic belongs to one account |
| `doctors` | `id`, `clinic_id` (FK), `name`, `department`, `gender`, `age`, `phone` | |
| `doctor_availability` | `id`, `doctor_id` (FK), `date`, `start_time`, `end_time` | |
| `doctor_leave` | `id`, `doctor_id` (FK), `start_date`, `end_date`, `reason` | Optional |
| `patients` | `id`, `clinic_id` (FK), `patient_code` (e.g. `PT-2026-0001`), `name`, `age`, `gender`, `mobile_number`, `address`, `city`, `created_at` | |
| `registrations` | `id`, `clinic_id` (FK), `patient_id` (FK), `doctor_id` (FK), `department`, `amount`, `visit_date`, `created_by` (user_id) | The appointment/visit + revenue record |
| `registration_edit_log` | `id`, `registration_id` (FK), `edited_by_user_id`, `role_at_time`, `changed_fields` (JSON), `timestamp` | Immutable audit trail |
| `notifications` | `id`, `account_id`, `clinic_id` (nullable), `type`, `message`, `related_record_id`, `read`, `created_at` | |
| `whatsapp_messages` | `id`, `clinic_id`, `patient_id`, `template_name`, `status`, `sent_at` | Logged sends via the BSP |

**Isolation model**: every clinic-scoped table carries `clinic_id`; every account-scoped
table carries `account_id`. Row-level scoping is enforced in the application layer
(every query filtered by the logged-in user's account, and further by clinic where the
user's role is clinic-scoped) — this is a deliberate reversal of the old
"isolated database per clinic" model.

---

## 8. System Architecture (Reference)

- **Frontend/Backend**: Next.js (App Router) + Tailwind CSS — single codebase, single deployment
- **Database**: One Hostinger MySQL database, shared across all accounts/clinics
- **ORM**: Prisma
- **Auth**: Auth.js (NextAuth.js) with Credentials provider + email verification flow
- **Messaging**: Third-party WhatsApp BSP (provider TBD)
- **Roles**: Custom RBAC — permissions checked at the API layer, not just hidden in the UI

## 9. Non-Functional Requirements

- **Data scoping**: Every API route must filter by `accountId`, and by `clinicId` where the requester's role is clinic-scoped. A Staff user for Clinic A must never be able to fetch Clinic B's data by guessing an ID.
- **Audit integrity**: `registration_edit_log` entries are append-only — never updated or deleted, even by Owner.
- **RBAC enforcement**: Permission checks happen server-side on every mutating request, not just conditionally rendered in the UI.
- **Email verification**: Login is blocked until `email_verified_at` is set.
- **Compliance**: WhatsApp sends only use provider-approved templates.

## 10. Assumptions & Dependencies

- **WhatsApp BSP provider is not yet named.** The PRD assumes a generic BSP with a template-send endpoint and delivery-status webhook — confirm the actual provider (e.g. Interakt, Gupshup, AiSensy, Wati) before building `lib/whatsapp.ts`, since auth method and payload shape differ per provider.
- **Email verification requires a transactional email service** (e.g. Resend, SendGrid) — not yet selected; needed before Stage 1 (signup) can be finished end-to-end.
- **Patient ID uniqueness scope**: assumed account-wide (not per-clinic) sequential numbering, resetting yearly. Flag if it should be per-clinic instead.

## 11. Constraints

- Budget-conscious build — avoid stacking additional paid vendors beyond what's confirmed here.

## 12. Glossary

- **Account**: the top-level tenant created at signup; can own multiple clinics.
- **BSP**: WhatsApp Business Solution Provider — a third-party platform that provides API access to WhatsApp Business messaging.
- **RBAC**: Role-Based Access Control.