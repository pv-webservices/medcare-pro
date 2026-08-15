import { notImplemented } from "@/lib/utils";

// Doctors — PRD §6.4 (FR-4.1, FR-4.2). List and create, filterable by clinic.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/doctors");
}

export async function POST() {
  return notImplemented("POST /api/doctors");
}
