import { notImplemented } from "@/lib/utils";

// Roles — PRD §6.8 (FR-8.1, FR-8.2). Create roles and assign them, optionally clinic-scoped.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/roles");
}

export async function POST() {
  return notImplemented("POST /api/roles");
}

export async function PATCH() {
  return notImplemented("PATCH /api/roles");
}
