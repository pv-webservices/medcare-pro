---
name: secure-webhooks
description: Patterns for securely handling inbound webhooks in MEDCARE PRO (currently the WhatsApp BSP delivery-status callback). Use when building or touching api/whatsapp/webhook or any future inbound webhook route.
---

# Secure Webhook Handling

MEDCARE PRO has publicly reachable webhook routes that accept unauthenticated
POST requests. Every one of them must treat its payload as untrusted input.

> **v2 note:** Twilio/IVR is out of MVP scope — if you're reading this because
> you're building a Twilio route, stop and confirm that's actually in scope
> again, since it was deliberately removed.

## Signature verification — non-negotiable, provider-agnostic

- Every inbound webhook must verify the sender's signature **before** parsing
  or acting on the body. Reject with `403` on failure — don't process first
  and check after.
- The specific header name and verification algorithm depend on which
  WhatsApp BSP is in use (each provider signs differently — HMAC-SHA256 over
  a shared secret is common, but the header name and encoding vary). **Do
  not hardcode Meta's `X-Hub-Signature-256` scheme** — that assumption is
  gone under v2. Implement verification against whatever scheme the chosen
  BSP's documentation specifies, in one place (e.g.
  `lib/whatsapp.ts#verifyWebhookSignature`), not inlined in the route.
- If the BSP isn't chosen yet, stub the verification function with a clear
  `throw new Error("Not implemented — pending provider selection")` rather
  than skipping the check "for now." A skipped check has a way of surviving
  into production.

## Idempotency

- BSPs commonly retry webhook delivery on timeout — the same event can
  arrive twice. Before writing a delivery-status update or triggering a
  side effect, check whether that event (by message ID) has already been
  processed.

## Data handling

- Don't log full webhook payloads (which include phone numbers) to
  persistent/plaintext logs beyond what's needed to update
  `whatsapp_messages` or match a patient record.
- Validate and typecheck every field pulled from a webhook payload before
  writing it to the database — never assume the provider's payload shape is
  guaranteed clean.

## Fail-safe behavior

- If a database write fails while processing a webhook, log the error and
  still return a `200` to the BSP if the payload itself was valid — an
  unexpected `5xx` will trigger provider-side retries and can compound the
  problem rather than fix it.