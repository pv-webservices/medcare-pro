import {
  assertClinicInTenant,
  can,
  requirePermission,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";

/** Shared scope and permission boundary for clinic telephony administration. */
export async function assertActorCanManageTelephony(
  actor: ActorContext,
  clinicId: string,
): Promise<void> {
  await assertClinicInTenant(actor.tenantId, clinicId);
  if (!(await can(actor, "clinic:read", clinicId))) {
    throw new ScopeError();
  }
  await requirePermission(actor, "clinic:edit", clinicId);
}
