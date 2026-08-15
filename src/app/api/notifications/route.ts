import { notImplemented } from "@/lib/utils";

// Notifications — PRD §6.7 (FR-7.1, FR-7.2). PATCH marks read/unread.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/notifications");
}

export async function PATCH() {
  return notImplemented("PATCH /api/notifications");
}
