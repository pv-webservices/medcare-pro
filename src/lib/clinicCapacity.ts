import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ClinicCapacityConfigurationError,
  ClinicLimitReachedError,
} from "@/lib/clinicCapacityErrors";
import {
  calculateClinicCapacity,
  capacityStatus,
} from "@/lib/clinicCapacityPolicy";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PLAN_KEY } from "@/lib/defaultFeatures";

type CapacityClient = PrismaClient | Prisma.TransactionClient;

// Review actions perform an initial lookup before taking the allocation lock.
// READ COMMITTED makes their post-lock reads current. Keep lock/pool waits
// bounded, but allow plan-wide policy edits more than Prisma's 5-second default.
export const clinicCapacityTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000,
  timeout: 30_000,
};

const requestSelect = {
  id: true,
  requestType: true,
  requestedQuantity: true,
  requestedPlanId: true,
  status: true,
  paymentStatus: true,
  paymentReference: true,
  organizationNote: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  requestedPlan: { select: { id: true, key: true, name: true, includedClinics: true } },
} satisfies Prisma.ClinicCapacityRequestSelect;

export async function resolveClinicCapacity(
  tenantId: string,
  options: { client?: CapacityClient; now?: Date; includePlans?: boolean } = {},
) {
  const client = options.client ?? prisma;
  const now = options.now ?? new Date();
  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      status: true,
      plan: {
        select: {
          id: true,
          key: true,
          name: true,
          isActive: true,
          includedClinics: true,
          additionalClinicPrice: true,
          additionalClinicCurrency: true,
          additionalClinicBillingInterval: true,
        },
      },
    },
  });

  if (!tenant) throw new ClinicCapacityConfigurationError();

  // Explicit compatibility for historical ACTIVE tenants only. The allowance
  // still comes from the Standard Plan row; NO_PLAN remains visible until a
  // Superadmin makes an explicit commercial assignment.
  const compatibilityPlan =
    tenant.plan === null && tenant.status === "ACTIVE"
      ? await client.plan.findUnique({
          where: { key: DEFAULT_PLAN_KEY },
          select: {
            id: true,
            key: true,
            name: true,
            isActive: true,
            includedClinics: true,
            additionalClinicPrice: true,
            additionalClinicCurrency: true,
            additionalClinicBillingInterval: true,
          },
        })
      : null;
  const capacityPlan = tenant.plan ?? compatibilityPlan;

  const [usedClinics, grants, pendingRequest, latestRequest, higherPlans] = await Promise.all([
    client.clinic.count({ where: { tenantId } }),
    client.tenantClinicCapacityGrant.findMany({
      where: { tenantId },
      orderBy: { approvedAt: "desc" },
      select: {
        id: true,
        quantity: true,
        type: true,
        status: true,
        startsAt: true,
        expiresAt: true,
        approvedAt: true,
      },
    }),
    client.clinicCapacityRequest.findFirst({
      where: {
        tenantId,
        status: { in: ["PENDING", "PAYMENT_PENDING", "PAYMENT_SUBMITTED", "UNDER_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
      select: requestSelect,
    }),
    client.clinicCapacityRequest.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: requestSelect,
    }),
    options.includePlans && tenant.plan
      ? client.plan.findMany({
          where: {
            isActive: true,
            id: { not: tenant.plan.id },
            includedClinics: { gt: tenant.plan.includedClinics },
          },
          orderBy: [{ includedClinics: "asc" }, { sortOrder: "asc" }],
          select: { id: true, key: true, name: true, includedClinics: true },
        })
      : Promise.resolve([]),
  ]);

  const calculated = calculateClinicCapacity({
    includedClinics: capacityPlan?.includedClinics ?? 0,
    usedClinics,
    grants,
    now,
  });

  const activeGrants = grants.filter(
    (grant) =>
      grant.status === "ACTIVE" &&
      grant.startsAt <= now &&
      (grant.expiresAt === null || grant.expiresAt > now),
  );

  return {
    tenantStatus: tenant.status,
    planId: tenant.plan?.id ?? null,
    planKey: tenant.plan?.key ?? null,
    planName: tenant.plan?.name ?? null,
    planActive: capacityPlan?.isActive ?? false,
    includedClinics: capacityPlan?.includedClinics ?? 0,
    additionalClinicPrice: capacityPlan?.additionalClinicPrice?.toFixed(2) ?? null,
    additionalClinicCurrency: capacityPlan?.additionalClinicCurrency ?? null,
    additionalClinicBillingInterval:
      capacityPlan?.additionalClinicBillingInterval ?? null,
    ...calculated,
    usedClinics,
    hasPlan: tenant.plan !== null,
    capacityConfigured: capacityPlan !== null,
    usesCompatibilityPlan: tenant.plan === null && compatibilityPlan !== null,
    compatibilityPlanName: compatibilityPlan?.name ?? null,
    status: capacityStatus({
      hasPlan: tenant.plan !== null,
      usedClinics,
      effectiveLimit: calculated.effectiveLimit,
    }),
    activeGrants,
    pendingRequest,
    latestRequest,
    higherPlans,
  };
}

export async function lockTenantForClinicCapacity(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE
  `);
  if (rows.length !== 1) throw new ClinicCapacityConfigurationError();
}

export async function assertClinicCapacityAvailable(
  tenantId: string,
  client: CapacityClient = prisma,
): Promise<Awaited<ReturnType<typeof resolveClinicCapacity>>> {
  const capacity = await resolveClinicCapacity(tenantId, { client });
  if (!capacity.capacityConfigured) throw new ClinicCapacityConfigurationError();
  if (capacity.isAtLimit) throw new ClinicLimitReachedError();
  return capacity;
}
