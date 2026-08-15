import { notImplemented } from "@/lib/utils";

// Clinics — PRD §6.2 (FR-2.1, FR-2.2). List and create, scoped to the tenant.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/clinics");
}

export async function POST() {
  return notImplemented("POST /api/clinics");
}
