import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveTenantFeatureAccess } from "@/lib/featureResolution";
import { PatientPortalError } from "@/lib/patientPortalSecurity";

/** Layers GLOBAL + PLAN/OVERRIDE only. Patient identities have no staff role. */
export async function requirePatientPortalEntitlement(
  tenantId: string,
  db: Prisma.TransactionClient = prisma,
) {
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId, status: "ACTIVE", isPlatform: false },
    select: { planId: true },
  });
  const feature = await db.feature.findUnique({
    where: { key: "patient_portal" },
    select: { id: true, globalEnabled: true },
  });
  if (!tenant || !feature) throw new PatientPortalError(503);
  const planned = tenant.planId
    ? await db.planFeature.findUnique({
        where: {
          planId_featureId: { planId: tenant.planId, featureId: feature.id },
        },
        select: { enabled: true },
      })
    : null;
  const override = await db.tenantFeatureOverride.findUnique({
    where: { tenantId_featureId: { tenantId, featureId: feature.id } },
    select: { enabled: true },
  });
  if (
    !resolveTenantFeatureAccess({
      globalEnabled: feature.globalEnabled,
      planEnabled: planned?.enabled ?? null,
      tenantOverride: override?.enabled ?? null,
    }).allowed
  )
    throw new PatientPortalError(503);
}
