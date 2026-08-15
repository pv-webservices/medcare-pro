import { notImplemented } from "@/lib/utils";

// PRD §9 — Captures DTMF input, writes ivr_logs (FR-6.4, FR-6.5).
// TODO(IVR stage): validate X-Twilio-Signature (PRD §10 Security), then insert
// an IvrLog row (caller_phone, input_received, timestamp, status = pending).

export async function POST() {
  return notImplemented("POST /api/twilio/gather");
}
