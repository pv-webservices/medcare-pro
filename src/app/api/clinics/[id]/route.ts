import { notImplemented } from "@/lib/utils";

// Clinic detail — PRD §6.2 (FR-2.1).
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/clinics/[id]");
}

export async function PATCH() {
  return notImplemented("PATCH /api/clinics/[id]");
}

export async function DELETE() {
  return notImplemented("DELETE /api/clinics/[id]");
}
