import { notImplemented } from "@/lib/utils";

// PRD §9 — Delivery status callbacks (FR-5.4).
// TODO(WhatsApp stage): verify the Meta signature BEFORE processing the body
// (PRD §10 Security), then record sent/delivered/failed status.

export async function POST() {
  return notImplemented("POST /api/whatsapp/webhook");
}
