---
name: secure-webhooks
description: Patterns for securely handling Twilio and WhatsApp Cloud API webhooks in MEDCARE PRO — signature verification, idempotency, and safe failure. Use when building or touching any route under api/twilio/* or api/whatsapp/webhook.
---

# Secure Webhook Handling

MEDCARE PRO's Twilio and WhatsApp webhook routes are publicly reachable URLs
that accept unauthenticated POST requests. Every one of them needs to treat
its payload as untrusted input.

## Signature verification — non-negotiable

- **Twilio routes** (`api/twilio/voice`, `api/twilio/gather`): verify the
  `X-Twilio-Signature` header against the request using the Twilio auth
  token before touching the body. Reject with `403` on failure — do not
  process, do not log the caller's data.
- **WhatsApp routes** (`api/whatsapp/webhook`): verify the
  `X-Hub-Signature-256` header using the WhatsApp app secret before parsing
  the payload. Same rule — reject on failure, don't process first and check
  later.
- Never skip this "for now" during development — a project this is cloned
  into repeatedly will inherit whatever gets skipped once.

## Idempotency

- Twilio and Meta both retry webhook delivery on timeout, which means the
  same event can arrive twice. Before inserting a new `ivr_logs` row or
  sending a WhatsApp message, check whether that event (by call SID / message
  ID) has already been processed. A duplicate call log or a patient getting
  the same reminder twice is a real user-facing bug, not a theoretical one.

## Fail-safe behavior

- If a database write fails inside the Twilio voice/gather flow, the route
  must still return valid TwiML so the caller doesn't hear dead air or get
  disconnected. Log the DB error separately from the call-flow response —
  never let an internal error surface as a broken phone call.
- If a WhatsApp send fails, surface that failure to the admin dashboard (per
  FR-5.4) rather than swallowing it silently.

## Data handling

- Don't log full webhook payloads (which include phone numbers) to
  persistent/plaintext logs beyond what's actually needed to populate
  `ivr_logs` or match a patient record.
- Validate and typecheck every field pulled from a webhook payload
  (`caller_phone`, DTMF `input_received`, etc.) before writing it to the
  database — never assume Twilio's or Meta's payload shape is guaranteed
  clean.