import { notImplemented } from "@/lib/utils";

// Signup — PRD §6.1 (FR-1.1). Creates one Tenant + one owner User in a
// transaction, seeds the default roles, assigns Owner, then sends the FR-1.2
// verification email. The Tenant stays unverified until the link is followed.
// Scoping: derive tenantId from the session; never trust a client-supplied
// tenantId/clinicId. Mutations call requirePermission() from lib/rbac.ts first.

export async function POST() {
  return notImplemented("POST /api/auth/signup");
}
