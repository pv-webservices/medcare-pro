import { notImplemented } from "@/lib/utils";

// Email verification — PRD §6.1 (FR-1.2, FR-1.3). Consumes a VerificationToken
// and sets tenants.email_verified_at. POST also serves FR-1.5's resend option.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function GET() {
  return notImplemented("GET /api/auth/verify-email");
}

export async function POST() {
  return notImplemented("POST /api/auth/verify-email");
}
