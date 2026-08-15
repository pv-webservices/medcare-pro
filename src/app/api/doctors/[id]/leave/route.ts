import { notImplemented } from "@/lib/utils";

// Doctor leave — PRD §6.4 (FR-4.4). Optional date range + reason.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/doctors/[id]/leave");
}

export async function POST() {
  return notImplemented("POST /api/doctors/[id]/leave");
}

export async function DELETE() {
  return notImplemented("DELETE /api/doctors/[id]/leave");
}
