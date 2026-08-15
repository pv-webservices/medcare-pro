import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SELECTED_CLINIC_COOKIE } from "@/lib/cookieNames";
import { accessibleClinicScope, type ActorContext } from "@/lib/rbac";

/**
 * The clinic currently selected in the switcher — FR-2.3.
 *
 * The cookie is user-editable, so it is treated as a *request*, not a fact.
 * `resolveSelectedClinicId` re-derives what the actor may actually reach and
 * discards anything outside it, which is why every consumer must go through
 * this function rather than reading the cookie directly.
 *
 * Server-only: this imports `next/headers`. Client components take the resolved
 * value as a prop.
 */

export { SELECTED_CLINIC_COOKIE };

/**
 * Returns the selected clinic id, or null for "every clinic I can see".
 *
 * Null is returned — rather than an error — when the cookie names a clinic the
 * actor cannot reach: a stale selection after a role change should quietly fall
 * back to the unfiltered view, not lock the user out of every page.
 */
export async function resolveSelectedClinicId(
  actor: ActorContext,
  permission = "clinic:read",
): Promise<string | null> {
  const store = await cookies();
  const requested = store.get(SELECTED_CLINIC_COOKIE)?.value?.trim();

  if (!requested) {
    return null;
  }

  const access = await accessibleClinicScope(actor, permission);

  if (access.scope === "none") {
    return null;
  }

  if (access.scope === "clinics") {
    return access.clinicIds.includes(requested) ? requested : null;
  }

  // Tenant-wide reach still has to be confirmed against this tenant — the
  // cookie could name a real clinic belonging to somebody else.
  const clinic = await prisma.clinic.findFirst({
    where: { id: requested, tenantId: actor.tenantId },
    select: { id: true },
  });

  return clinic ? requested : null;
}
