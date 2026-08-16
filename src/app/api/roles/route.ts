import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  assignRole,
  createRole,
  createRoleSchema,
  getRolesOverview,
  roleMutationSchema,
  unassignRole,
  updateRole,
} from "@/lib/roles";
import { requireActor } from "@/lib/session";

// Roles — PRD §6.8 (FR-8.1, FR-8.2). Create roles and assign them, optionally clinic-scoped.
//
// Scoping: tenantId comes from the session; a client-supplied userId, roleId or
// clinicId is verified against it in @/lib/roles before anything is written.
//
// `role:manage` is required account-wide for every write — a clinic-scoped
// grant of it would let someone rewrite roles reaching clinics they cannot see.
// The escalation and lockout guards (you cannot grant what you do not hold; the
// wildcard is never mintable; the account always keeps an owner) live in
// @/lib/roles, so they apply to every caller rather than to this route only.
//
// PATCH carries a discriminated `action` because the scaffold defines no DELETE:
// updating a role, assigning one, and unassigning one are all modifications of
// existing configuration.

export async function GET() {
  try {
    const actor = await requireActor();
    return jsonOk(await getRolesOverview(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/roles");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = createRoleSchema.parse(await readJsonBody(request));

    return jsonOk(await createRole(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/roles");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    const input = roleMutationSchema.parse(await readJsonBody(request));

    switch (input.action) {
      case "updateRole":
        return jsonOk(await updateRole(actor, input));
      case "assign":
        return jsonOk(await assignRole(actor, input));
      case "unassign":
        return jsonOk(await unassignRole(actor, input));
    }
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/roles");
  }
}
