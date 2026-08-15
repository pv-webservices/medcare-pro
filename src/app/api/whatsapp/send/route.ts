import { notImplemented } from "@/lib/utils";

// PRD §9 — Send a pre-approved template message (FR-5.1, FR-5.2).
// TODO(WhatsApp stage): call the Meta Cloud API via `@/lib/whatsapp`.
// Pre-approved templates only — no free-text sends (PRD §10 Compliance).
// Requires an authenticated session (PRD §10 Security).

export async function POST() {
  return notImplemented("POST /api/whatsapp/send");
}
