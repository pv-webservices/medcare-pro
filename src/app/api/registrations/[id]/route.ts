import { notImplemented } from "@/lib/utils";

// Registration detail — PRD §6.3 (FR-3.5, FR-3.6). Every PATCH must write a
// registration_edit_log row in the same transaction: who, role at the time,
// what changed. There is no code path that edits without logging.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/registrations/[id]");
}

export async function PATCH() {
  return notImplemented("PATCH /api/registrations/[id]");
}
