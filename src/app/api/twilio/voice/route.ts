import { notImplemented } from "@/lib/utils";

// PRD §9 — Incoming call webhook, returns TwiML (FR-6.3).
// TODO(IVR stage): validate X-Twilio-Signature (PRD §10 Security), check
// ClinicSettings, and return the "Press 1 to request an appointment" TwiML when
// closed. Unconfigured hours must fail safe to "closed" (FR-6.6 acceptance).
// The call must complete gracefully even if the DB is unreachable (PRD §10 Reliability).

export async function POST() {
  return notImplemented("POST /api/twilio/voice");
}
