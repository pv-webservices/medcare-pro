import { notImplemented } from "@/lib/utils";

// Audit trail — PRD §6.3 (FR-3.6). Append-only and read-only: no write method
// exists here by design (PRD §9 Audit integrity).
// Requires 'registration:history:read' — Staff hold the edit permission but not
// this one, and the 403 must come from here, not from a hidden UI tab.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/registrations/[id]/history");
}
