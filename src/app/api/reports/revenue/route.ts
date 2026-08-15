import { notImplemented } from "@/lib/utils";

// Revenue report — PRD §6.6 (FR-6.1 … FR-6.4). Aggregates registrations by
// visit_date over daily/weekly/monthly/yearly windows, broken down by clinic
// and by doctor.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/reports/revenue");
}
