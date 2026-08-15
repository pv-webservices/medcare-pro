# Product Requirements Document (PRD)
## Automated Clinic Management System

| | |
|---|---|
| **Version** | 1.0 |
| **Owner** | Sitecraf (Pramod Verma) |
| **Purpose** | Reference document for AI coding agents (Claude, Gemini, etc.) building this project in Antigravity IDE |

> **Note to AI agents building this project:** This PRD is the single source of truth for *what* to build and *why*. Follow the data model and functional requirements exactly. Do not introduce features, tables, or pages not listed here without flagging it first.

---

## 1. Product Overview

A multi-tenant clinic management web application. Each clinic gets an isolated deployment with its own database, admin login, patient records, WhatsApp messaging, and an after-hours AI/IVR receptionist. Built for small clinics that currently rely on manual, paper-based, or spreadsheet-based operations.

## 2. Problem Statement

1. Clinics lose patients to unanswered after-hours calls.
2. Front-desk staff track revenue and patient counts manually.
3. Patient communication (reminders, updates) is inconsistent and depends on someone remembering to call.

## 3. Goals

- Give clinic staff one dashboard for daily operations (revenue, patients, appointments).
- Never lose an after-hours lead — capture it automatically and surface it the next morning.
- Reduce no-shows via automated WhatsApp reminders.
- Keep each clinic's data fully isolated (multi-tenant by design, not by shared table with a `clinic_id` filter).

## 4. Users

| User | Role |
|---|---|
| Clinic Admin / Front-desk staff | Logs in daily, manages patients/appointments, sends WhatsApp messages, monitors dashboard |
| Patient | Indirect user — receives WhatsApp messages, interacts with the IVR when calling after hours |
| Platform Operator (Sitecraf) | Deploys and maintains each clinic's instance |

## 5. Scope

### In Scope (MVP)
- Admin authentication (single admin login per clinic for MVP)
- Patient directory (CRUD)
- Appointment logging (CRUD)
- Live dashboard: today's revenue, today's patient count, patient search
- WhatsApp: send pre-approved templates manually + automated 24-hour appointment reminders
- Clinic working-hours settings + manual emergency toggle
- Twilio IVR: after-hours call handling, DTMF capture, call logging, dashboard notification

### Out of Scope (MVP) — Future Roadmap
- Patient self-service booking portal
- Multi-staff logins with role-based permissions
- SMS fallback
- Cross-clinic usage/billing dashboard for the platform operator
- Native mobile app

---

## 6. Functional Requirements

### 6.1 Authentication
- **FR-1.1**: Admin can log in with email + password via Auth.js.
- **FR-1.2**: Sessions persist securely; unauthenticated users are redirected to `/login`.
- **Acceptance criteria**: Invalid credentials show an error, no stack trace leaked; valid login redirects to `/dashboard`.

### 6.2 Patient Management
- **FR-2.1**: Admin can create a patient record (name, phone number, required; created_at auto-set).
- **FR-2.2**: Admin can view a list of all patients with search-by-name or phone.
- **FR-2.3**: Admin can view a single patient's record, including their appointment history.
- **FR-2.4**: Admin can edit or delete a patient record.
- **Acceptance criteria**: Search returns matches as the admin types (debounced); duplicate phone numbers are flagged, not silently allowed.

### 6.3 Appointment Management
- **FR-3.1**: Admin can log an appointment against an existing patient: visit date, reason, amount paid.
- **FR-3.2**: Appointments list is filterable by date range.
- **FR-3.3**: Every appointment logged updates the dashboard's daily revenue/patient totals in real time.
- **Acceptance criteria**: Amount paid accepts decimal values; a malformed date is rejected client-side before submission.

### 6.4 Dashboard
- **FR-4.1**: Dashboard shows "Total Revenue (Today)" — sum of `amount_paid` for appointments where `visit_date` = today.
- **FR-4.2**: Dashboard shows "Total Patients (Today)" — count of distinct patients with an appointment today.
- **FR-4.3**: Dashboard shows a notification list of unactioned after-hours IVR calls (from `ivr_logs`, status = pending).
- **Acceptance criteria**: Values recalculate on page load without a manual refresh button; zero-state ("No appointments yet today") is handled gracefully.

### 6.5 WhatsApp Communication
- **FR-5.1**: Admin selects a patient + a pre-approved Meta template from a dropdown, clicks Send.
- **FR-5.2**: Backend route calls the WhatsApp Cloud API with the template payload.
- **FR-5.3**: System automatically sends a reminder template 24 hours before a logged appointment's `visit_date`.
- **FR-5.4**: Delivery status (sent/delivered/failed) is logged and visible against the message.
- **Acceptance criteria**: Only Meta-approved templates are selectable (no free-text messaging in MVP — stays compliant with WhatsApp policy); failed sends show a retry option.

### 6.6 Smart After-Hours Receptionist (IVR)
- **FR-6.1**: Admin sets weekly working hours (day + start/end time) in Clinic Settings.
- **FR-6.2**: Admin can manually toggle IVR "ON" regardless of schedule (emergency override).
- **FR-6.3**: Incoming call → Twilio webhook hits the API → API checks `clinic_settings` → if closed, play the "Press 1 to request an appointment" TwiML message.
- **FR-6.4**: DTMF input ('1') is written to `ivr_logs` (caller_phone, input_received, timestamp, status = pending).
- **FR-6.5**: New `ivr_logs` entry triggers a dashboard notification (FR-4.3).
- **FR-6.6**: Admin can mark a logged call as "actioned" once they've called the patient back.
- **Acceptance criteria**: If working hours are not yet configured, IVR defaults to "closed" (fail-safe toward capturing the lead, not losing it).

---

## 7. Data Model

| Table | Key Fields | Notes |
|---|---|---|
| `users` / `sessions` | Standard Auth.js fields | Admin credentials, session tokens |
| `patients` | `id`, `name`, `phone_number`, `created_at` | Core patient directory |
| `appointments` | `id`, `patient_id` (FK), `visit_date`, `reason`, `amount_paid` | Drives dashboard metrics |
| `clinic_settings` | `id`, `working_days`, `office_hours_start`, `office_hours_end`, `manual_ivr_toggle` | Single row per clinic instance |
| `ivr_logs` | `id`, `caller_phone`, `input_received`, `timestamp`, `status` | `status`: pending / actioned |

Each clinic's deployment has its own instance of this schema in its own dedicated MySQL database — no shared tables across clinics.

---

## 8. System Architecture (Reference)

- **Frontend/Backend**: Next.js (React) + Tailwind CSS, single codebase per clinic
- **Database**: Hostinger MySQL, one isolated instance per clinic
- **ORM**: Prisma
- **Auth**: Auth.js (NextAuth.js)
- **Messaging**: WhatsApp Cloud API (Meta)
- **Voice**: Twilio (IVR, DTMF capture)

Full folder structure is defined in the separate Project Structure document.

## 9. Key API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | Auth.js handler |
| `/api/patients` | GET/POST/PUT/DELETE | Patient CRUD |
| `/api/appointments` | GET/POST/PUT/DELETE | Appointment CRUD |
| `/api/clinic-settings` | GET/PUT | Working hours + IVR toggle |
| `/api/whatsapp/send` | POST | Send a template message |
| `/api/whatsapp/webhook` | POST | Receive delivery status callbacks |
| `/api/twilio/voice` | POST | Twilio webhook — incoming call, returns TwiML |
| `/api/twilio/gather` | POST | Twilio webhook — captures DTMF input |

---

## 10. Non-Functional Requirements

- **Data isolation**: One clinic must never be able to query or see another clinic's data, enforced at the database level (separate DB), not just application-level filtering.
- **Security**: All admin routes require an authenticated session; WhatsApp/Twilio webhook routes must validate the incoming request signature (Meta/Twilio signing secret) before processing.
- **Compliance**: Only pre-approved WhatsApp templates are sent — no free-form outbound messaging, to stay within Meta's policy.
- **Reliability**: If the IVR webhook fails to reach the database, the call should still complete gracefully for the caller (no dead air).
- **Performance**: Dashboard metrics should load in under 2 seconds for a single clinic's typical data volume.

## 11. Assumptions & Dependencies

- Meta WhatsApp Business/Cloud API access is approved before Phase 3 messaging work begins (approval can take several days — apply early).
- A Twilio account and phone number are provisioned before IVR work begins.
- Each clinic has a Hostinger MySQL database provisioned before that clinic's deployment starts.

## 12. Constraints

- Budget-conscious build — avoid stacking additional paid vendors beyond what's specified here (Hostinger, WhatsApp Cloud API, Twilio).

## 13. Glossary

- **DTMF**: Dual-tone multi-frequency — the keypad tones Twilio captures when a caller presses a number.
- **TwiML**: Twilio's XML-based markup for defining call behavior.
- **Multi-tenant (this project's model)**: Each clinic = its own isolated database + deployment, not shared tables with a tenant filter.
