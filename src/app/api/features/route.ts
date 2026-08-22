import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  getFeatureOverview,
  setRoleFeatureAccess,
  setRoleFeatureSchema,
} from "@/lib/features";
import { requireActor } from "@/lib/session";

// Feature entitlements, tenant side — Stage 8.
//
// GET is the Features screen; PATCH is one role's layer-3 switch. Both are
// gated by `feature:view` / `feature:manage` inside @/lib/features, so the
// guards travel with the logic rather than with this route.
//
// DELIBERATELY NOT FEATURE-GATED. Every other tenant module calls
// `requireModule` here; this one must not. If a feature switch could close the
// screen that undoes a feature switch, an organisation could lock itself out of
// its own settings with no in-app remedy — see UNGATED_MODULES.
//
// There is no POST and no DELETE: layer 3 is a tri-state on an existing (role,
// feature) pair, so writing, clearing and flipping it are all one PATCH. `null`
// clears the row and returns the role to inheriting the organisation.
//
// Layers 1 and 2 — the platform kill switch and per-tenant overrides — are not
// writable from anywhere in this route. They belong to the Platform Owner and
// arrive in Stage 9.

export async function GET() {
  try {
    const actor = await requireActor();
    return jsonOk(await getFeatureOverview(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/features");
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor();
    const input = setRoleFeatureSchema.parse(await readJsonBody(request));
    await setRoleFeatureAccess(actor, input);

    // The whole overview comes back rather than the one row: flipping a switch
    // changes the effective column for that role, and re-deriving it on the
    // client would be a second copy of the resolver.
    return jsonOk(await getFeatureOverview(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/features");
  }
}
