import { accessibleClinicScope, type ActorContext } from "@/lib/rbac";

/**
 * Turns "which clinics may this actor reach?" into a Prisma `where` fragment.
 *
 * Every clinic-scoped list in the app needs the same three-way resolution, so it
 * is written once here rather than repeated per module:
 *
 *   - the actor reaches nothing              → null (caller returns an empty list)
 *   - the actor asked for one clinic         → narrow to it, but only if it is
 *                                              inside their own scope
 *   - the actor asked for no clinic          → every clinic their roles reach
 *
 * The requested clinic id is a FILTER, not an authorisation. It arrives from the
 * clinic switcher cookie or a query string, both user-editable, so it is
 * intersected with the actor's scope: naming a clinic outside it yields nothing
 * rather than widening the result. `tenantId` always comes from the session.
 */

export interface ClinicWhere {
  tenantId: string;
  id?: string | { in: string[] };
}

export async function clinicWhereForActor(
  actor: ActorContext,
  permission: string,
  requestedClinicId?: string | null,
): Promise<ClinicWhere | null> {
  const access = await accessibleClinicScope(actor, permission);

  if (access.scope === "none") {
    return null;
  }

  const requested = requestedClinicId?.trim() ? requestedClinicId.trim() : null;

  if (access.scope === "clinics") {
    if (requested) {
      // Outside their scope — match nothing rather than falling back to "all".
      return access.clinicIds.includes(requested)
        ? { tenantId: actor.tenantId, id: requested }
        : null;
    }

    return { tenantId: actor.tenantId, id: { in: [...access.clinicIds] } };
  }

  // Tenant-wide reach. The tenant filter still stands, so a requested id
  // belonging to another tenant simply matches nothing.
  return requested
    ? { tenantId: actor.tenantId, id: requested }
    : { tenantId: actor.tenantId };
}
