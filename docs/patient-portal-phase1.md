# Patient Portal authentication (Phase 1.1)

Patient authentication is separate from staff User/Auth.js, LoginCode, and staff password recovery. Clinical pages and SELF-only resource authorization continue to use PatientPortalLink and the opaque PatientPortalSession cookie.

## Clinic activation

Authorized staff with `patient_portal:manage`, exact clinic/tenant scope, and the `patient_portal` entitlement confirm the patient's identity in person from Registration Detail. The server locks the Patient, invalidates earlier activations, and returns a one-time activation URL only in the authorized no-store response. The URL contains a random 32-byte token; only its SHA-256 hash is persisted. Its lifetime is 15 minutes.

The staff browser renders a local SVG QR with react-qr-code. It can print the activation card or generate a new QR. Closing the card clears the raw URL from component state. Reloading shows pending activation and Generate New QR; the server cannot reconstruct a raw QR. No localStorage or automatic delivery is used.

The patient scans using their own device, creates and confirms a password, and optionally enters a recovery email. Token context determines Patient and Tenant; browser IDs cannot choose an identity. Activation locks the Patient and existing account, consumes the token, creates a fresh ACTIVE SELF link generation and a 12-hour session, and records the activation audit. Reenable requires fresh password setup and cannot revive old sessions.

## Password login

Normal login is Organization (Tenant.slug) + Patient ID (tenant-scoped Patient.patientCode) + password. `/patient/login?org=<slug>` syntactically normalizes and prefills the organization without looking up or revealing its existence. Patient codes are trimmed and uppercased. The public clinic login URL contains no patient code or authentication secret and is available from the staff card.

Passwords accept 10–128 characters, including spaces and Unicode, without arbitrary complexity rules. A domain-separated SHA-256 prehash of the entire UTF-8 password is passed to bcryptjs with cost 12, avoiding bcrypt's silent 72-byte truncation. The prehash and plaintext are never persisted or logged. All patient password creation and comparison use this versioned input encoding. The account stores only the resulting bcrypt hash.

Unknown organization/code, wrong password, disabled/revoked account, and missing password credential return `Invalid sign-in details.` Nonexistent identities use a constant cost-12 dummy bcrypt hash. DB-backed limits cover IP and a SHA-256 hash of organization + patient code. Clinical mobile numbers and email addresses are never login authority.

## Verified recovery email

Recovery email belongs to PatientPortalAccount, not Patient or staff User. Typed addresses are normalized and pending until possession is explicitly confirmed. The dedicated PatientPortalSecurityToken table stores only SHA-256 token hashes, purpose, account, email snapshot, expiry, and lifecycle timestamps.

Verification email expires in 24 hours. `/patient/verify-email?token=...` only renders a confirmation; GET never consumes it. POST locks the account, checks the token, active SELF access and entitlement, atomically enforces unique recoveryEmail, consumes the token and records an audit. A conflicting inbox reveals no other identity. Replacing an address also invalidates outstanding reset tokens for the previous address.

Profile → Security & Recovery shows masked verified and pending addresses. Adding or changing recovery email requires current-password reauthentication, and the old verified address remains authoritative until replacement verification succeeds. Resend requires a 60-second cooldown and a small hourly account/IP limit; it invalidates the old verification token. Removing recovery email is intentionally not offered in this phase.

Security emails use the existing Resend `sendTransactionalEmail` transport and contain no clinical information. An injected mailer captures all automated test mail. Optional local-file capture requires a nonproduction process, an explicit flag, and a dedicated localhost `medcare_ep_portal_` database; copied flags cannot enable it in production. No debug token endpoint exists.

Recovery email delivery failure does not roll back password activation. The patient's Profile shows the delivery warning and permits resend. Provider errors and credentials are not returned or logged.

## Forgot password

`/patient/forgot-password` requires Organization + Patient ID + Recovery email. Every valid-shaped request returns the same neutral response, including unknown identity, wrong email, revoked account, and unverified/missing email. Only an exact active identity and verified inbox receive mail.

Reset tokens expire in 15 minutes, have 32 bytes of entropy, and are single-use. New reset requests revoke earlier tokens. GET opens the form without consuming anything. POST hashes the new password outside the transaction, locks the account, checks the purpose/email snapshot/live token/active access, changes the credential, consumes the token, revokes all account sessions and outstanding security tokens, and audits completion. Pending email changes authorized with the old password are cleared. Reset never auto-signs in; return to login with confirmation.

## Staff recovery and revocation

Reset Portal Access requires fresh in-person identity confirmation and the same staff authorization as activation. Under Patient/account locks it disables the account, clears password and recovery authority, revokes all sessions, revokes active links while preserving history, invalidates security and activation tokens, and issues a STAFF_RECOVERY QR. Old credentials immediately fail. Redemption creates a fresh password/link/session; email may be added and verified again.

Revoke Access disables the account, revokes sessions and active links, and invalidates activation and email/reset tokens. Clinical rows and portal history are retained. Enable Again issues fresh QR/password setup.

## Legacy compatibility and migration

Migration `20260913020000_patient_portal_password_email_auth` follows the unchanged Phase 1 migration. It adds nullable password/recovery columns, nullable legacy mobile columns, activation purpose (existing rows default to LEGACY_SMS), and the dedicated security-token table. It does not rewrite clinical rows, invent credentials, or auto-link patients. PatientPortalChallenge remains temporarily as deprecated data; patient authentication has no runtime reads/writes to it.

Legacy mobile-only accounts remain readable, derive SETUP REQUIRED in staff UI, and cannot password-login. Generate Setup QR reuses only their patient-scoped account history; shared mobile numbers cannot combine accounts. Existing sessions remain governed by their original DB expiry/revocation checks; setup/recovery/revoke explicitly invalidate them.

`npx tsx scripts/backfill-patient-portal-password-auth.mts` is dry-run by default and reports aggregate legacy/account/activation/challenge counts. `--apply` revokes only outstanding LEGACY_SMS activations and invalidates unconsumed OTP challenges. It never deletes accounts, links, sessions or clinical rows; never creates passwords/email/activations; never sends messages. Remote apply requires explicit `--apply --allow-remote`. During this implementation the named production database is explicitly forbidden by the guard. Review the script and data before any later production execution.

## Messaging and environment

Patient Portal SMS/OTP runtime and its dedicated sender files are retired. Plivo SDK, IVR, Voice, number inventory and webhook signature validation remain supported. RkvRobo ordinary clinic messaging remains intact. RkvRobo is not authentication transport: never send QR activation secrets, reset tokens, passwords, OTPs or sessions through WhatsApp. Only public organization login URLs may be distributed through ordinary clinic messaging.

Patient Portal no longer uses PATIENT_PORTAL_DELIVERY_PROVIDER, PATIENT_PORTAL_SMS_SENDER or PATIENT_PORTAL_OTP_SECRET. Existing production values may remain unused until a separate approved cleanup.

Email recovery needs EMAIL_API_KEY, a verified Resend EMAIL_FROM_ADDRESS, and HTTPS AUTH_URL/NEXTAUTH_URL matching the public origin. No production environment is changed by this task.

## Validation and deployment boundary

All development/testing/migration replay/builds must explicitly use disposable local databases. `npm run build` runs `prisma migrate deploy`; never run it against production. Tests include password/QR/token/recovery races, shared mobile isolation, entitlement revocation, IDOR, clinical snapshots, backfill dry-run/apply/idempotence/remote guard, and desktop/mobile Playwright. Staff password-reset verification is separate.

CI uses disposable MariaDB and captured/injected email without Plivo SMS, RkvRobo or real Resend credentials. The review report records exact local results and existing dependency/build warnings.

This branch must be independently reviewed before any merge, production migration/backfill, deployment, environment change, real patient activation or real recovery mail. The SMS-fix branch is not a base and must not be merged.
