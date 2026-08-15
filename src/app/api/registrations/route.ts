import { notImplemented } from "@/lib/utils";

// Registrations — PRD §6.3 (FR-3.1 … FR-3.4). GET supports search, filter and
// CSV export. POST generates the patient code via lib/generatePatientCode.ts
// inside the same transaction, and writes the FR-3.6 audit log row.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/registrations");
}

export async function POST() {
  return notImplemented("POST /api/registrations");
}
