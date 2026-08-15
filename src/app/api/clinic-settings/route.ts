import { notImplemented } from "@/lib/utils";

// PRD §9 — Working hours + IVR toggle (FR-6.1, FR-6.2).
// TODO(IVR stage): read/update the single ClinicSettings row.
// Requires an authenticated session (PRD §10 Security).

export async function GET() {
  return notImplemented("GET /api/clinic-settings");
}

export async function PUT() {
  return notImplemented("PUT /api/clinic-settings");
}
