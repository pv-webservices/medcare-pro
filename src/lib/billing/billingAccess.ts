import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { clinicWhereForActor } from "@/lib/clinicScope";
import { ScopeError, type ActorContext } from "@/lib/rbac";

/** Resolve a browser's clinic selection against authoritative tenant and role scope. */
export async function billingClinic(actor: ActorContext, clinicId: string, tx: Prisma.TransactionClient = prisma) {
  const where = await clinicWhereForActor(actor, "invoice:read", clinicId, tx);
  if (!where) throw new ScopeError();
  const clinic = await tx.clinic.findFirst({ where, select: { id: true, tenantId: true, name: true } });
  if (!clinic) throw new ScopeError();
  return clinic;
}
