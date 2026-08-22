import { prisma } from "@/lib/prisma";
import { CUSTOMER_TENANT_WHERE } from "@/lib/platformTenant";
import { isTenantEntitled } from "@/lib/featureResolution";
import type { PlatformActorContext } from "@/lib/platform/context";
import type { FeatureTier, TenantStatus } from "@prisma/client";

/**
 * Clinic application READ models — Stage 3.
 *
 * Owner-facing reads, cross-tenant by design and by name. The writes live next
 * door in ./decisions.ts; keeping them apart is Stage 0 decision 7, and it means
 * a reviewer can see at a glance which functions can change something.
 *
 * NAMING — "application", not "registration". `registration` in this codebase
 * already means a patient's visit (PRD §7 `registrations`, src/lib/registrations.ts).
 * Reusing the word for a clinic signing up would collide with the busiest module
 * in the app. The Owner surface says "application"; the Stage 3 brief's
 * "registration" is the same thing.
 *
 * Every query composes CUSTOMER_TENANT_WHERE. The reserved platform tenant is
 * not a customer and must never appear in a queue an Owner acts on.
 */

export interface ClinicApplicationSummary {
  id: string;
  clinicName: string;
  slug: string | null;
  email: string;
  city: string | null;
  phone: string | null;
  status: TenantStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  planName: string | null;
  applicantName: string | null;
  /** How many logins exist under this organisation, applicant included. */
  userCount: number;
}

export type ApplicationStatusCounts = Record<TenantStatus, number>;

const EMPTY_COUNTS: ApplicationStatusCounts = {
  PENDING: 0,
  ACTIVE: 0,
  SUSPENDED: 0,
  REJECTED: 0,
  ARCHIVED: 0,
};

/** A page of the queue plus the tab counts rendered above it. */
export interface ClinicApplicationPage {
  applications: ClinicApplicationSummary[];
  counts: ApplicationStatusCounts;
  total: number;
}

export const APPLICATION_PAGE_SIZE = 25;

export interface ListApplicationsInput {
  status?: TenantStatus | null;
  /** Matches clinic name, contact email or city. */
  search?: string | null;
  page?: number;
}

/**
 * The approval queue — Stage 3 item 5.
 *
 * Takes the Owner context as a required argument even though it does not filter
 * by it: the type can only be produced by requirePlatformOwner(), so a caller
 * that has not authorized cannot call this at all.
 *
 * Ordered oldest-first when listing PENDING, because a queue is worked from the
 * front; newest-first otherwise, because those lists are browsed, not worked.
 */
export async function listClinicApplications(
  _owner: PlatformActorContext,
  input: ListApplicationsInput = {},
): Promise<ClinicApplicationPage> {
  const search = input.search?.trim();
  const page = Math.max(1, input.page ?? 1);

  const where = {
    ...CUSTOMER_TENANT_WHERE,
    ...(input.status ? { status: input.status } : {}),
    ...(search
      ? {
          OR: [
            { businessName: { contains: search } },
            { email: { contains: search } },
            { city: { contains: search } },
          ],
        }
      : {}),
  };

  const [rows, total, grouped] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: input.status === "PENDING" ? "asc" : "desc" },
      skip: (page - 1) * APPLICATION_PAGE_SIZE,
      take: APPLICATION_PAGE_SIZE,
      select: {
        id: true,
        businessName: true,
        slug: true,
        email: true,
        city: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        plan: { select: { name: true } },
        _count: { select: { users: true } },
      },
    }),
    prisma.tenant.count({ where }),
    prisma.tenant.groupBy({
      by: ["status"],
      where: CUSTOMER_TENANT_WHERE,
      _count: { _all: true },
    }),
  ]);

  // The applicant's name in one extra query rather than a correlated subquery
  // per row: `users.email` is unique, and one `IN` over a page of 25 is cheaper
  // than 25 joins that Prisma cannot express as a single-row relation here.
  const applicants = await prisma.user.findMany({
    where: { email: { in: rows.map((row) => row.email) } },
    select: { email: true, name: true },
  });
  const applicantByEmail = new Map(
    applicants.map((user) => [user.email, user.name]),
  );

  const counts = { ...EMPTY_COUNTS };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  return {
    total,
    counts,
    applications: rows.map((row) => ({
      id: row.id,
      clinicName: row.businessName,
      slug: row.slug,
      email: row.email,
      city: row.city,
      phone: row.phone,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt,
      createdAt: row.createdAt,
      planName: row.plan?.name ?? null,
      applicantName: applicantByEmail.get(row.email) ?? null,
      userCount: row._count.users,
    })),
  };
}

export interface FeatureEntitlementView {
  key: string;
  name: string;
  tier: FeatureTier;
  /** Layer 1 — the platform-wide kill switch. False beats everything below. */
  globalEnabled: boolean;
  /** Layer 2a — null when the plan does not list the feature at all. */
  planEnabled: boolean | null;
  /** Layer 2b — null when no override row exists for this tenant. */
  override: boolean | null;
  overrideReason: string | null;
  /** What layers 1 and 2 currently resolve to for this organisation. */
  effective: boolean;
}

export interface PlanOption {
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /**
   * The plan's own feature defaults, carried so the decision screen can show
   * what picking a different plan would grant BEFORE it is picked. Without it
   * the Owner would be choosing a plan blind and only seeing the consequence
   * after approving.
   */
  features: { key: string; enabled: boolean }[];
}

export interface ApplicationDecisionRecord {
  id: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  actorName: string | null;
}

export interface ClinicApplicationDetail extends ClinicApplicationSummary {
  address: string | null;
  primaryContactEmail: string | null;
  termsAcceptedAt: Date | null;
  planKey: string | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  applicantId: string | null;
  applicantEmailVerifiedAt: Date | null;
  features: FeatureEntitlementView[];
  plans: PlanOption[];
  history: ApplicationDecisionRecord[];
}

/**
 * One application in full, or null if the id names nothing an Owner may act on.
 *
 * Null covers both "no such tenant" and "that is the reserved platform tenant".
 * The caller renders the same 404 for either, so the platform row cannot be
 * probed for by id.
 */
export async function getClinicApplication(
  _owner: PlatformActorContext,
  tenantId: string,
): Promise<ClinicApplicationDetail | null> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, ...CUSTOMER_TENANT_WHERE },
    select: {
      id: true,
      businessName: true,
      slug: true,
      email: true,
      city: true,
      phone: true,
      address: true,
      primaryContactEmail: true,
      termsAcceptedAt: true,
      status: true,
      emailVerifiedAt: true,
      createdAt: true,
      approvedAt: true,
      rejectedAt: true,
      rejectionReason: true,
      suspendedAt: true,
      suspensionReason: true,
      plan: { select: { key: true, name: true, features: { select: { enabled: true, feature: { select: { key: true } } } } } },
      featureOverrides: {
        select: { enabled: true, reason: true, feature: { select: { key: true } } },
      },
      _count: { select: { users: true } },
    },
  });

  if (!tenant) {
    return null;
  }

  const [applicant, catalogue, plans, history] = await Promise.all([
    prisma.user.findFirst({
      where: { tenantId: tenant.id, email: tenant.email },
      select: { id: true, name: true, emailVerifiedAt: true },
    }),
    prisma.feature.findMany({
      orderBy: { key: "asc" },
      select: { key: true, name: true, tier: true, globalEnabled: true },
    }),
    prisma.plan.findMany({
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
      select: {
        key: true,
        name: true,
        description: true,
        isActive: true,
        features: { select: { enabled: true, feature: { select: { key: true } } } },
      },
    }),
    prisma.auditLog.findMany({
      where: { targetType: "Tenant", targetId: tenant.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    }),
  ]);

  const planDefaults = new Map(
    (tenant.plan?.features ?? []).map((row) => [row.feature.key, row.enabled]),
  );
  const overrides = new Map(
    tenant.featureOverrides.map((row) => [
      row.feature.key,
      { enabled: row.enabled, reason: row.reason },
    ]),
  );

  const features: FeatureEntitlementView[] = catalogue.map((feature) => {
    const planEnabled = planDefaults.has(feature.key)
      ? (planDefaults.get(feature.key) as boolean)
      : null;
    const override = overrides.get(feature.key);

    return {
      key: feature.key,
      name: feature.name,
      tier: feature.tier,
      globalEnabled: feature.globalEnabled,
      planEnabled,
      override: override?.enabled ?? null,
      overrideReason: override?.reason ?? null,
      // Layers 1 and 2 only. The role layer is per-role and belongs to the
      // Tenant Admin, so it has no meaning on this screen.
      effective:
        feature.globalEnabled &&
        isTenantEntitled({
          planEnabled,
          tenantOverride: override?.enabled ?? null,
        }),
    };
  });

  return {
    id: tenant.id,
    clinicName: tenant.businessName,
    slug: tenant.slug,
    email: tenant.email,
    city: tenant.city,
    phone: tenant.phone,
    address: tenant.address,
    primaryContactEmail: tenant.primaryContactEmail,
    termsAcceptedAt: tenant.termsAcceptedAt,
    status: tenant.status,
    emailVerifiedAt: tenant.emailVerifiedAt,
    createdAt: tenant.createdAt,
    planKey: tenant.plan?.key ?? null,
    planName: tenant.plan?.name ?? null,
    approvedAt: tenant.approvedAt,
    rejectedAt: tenant.rejectedAt,
    rejectionReason: tenant.rejectionReason,
    suspendedAt: tenant.suspendedAt,
    suspensionReason: tenant.suspensionReason,
    applicantId: applicant?.id ?? null,
    applicantName: applicant?.name ?? null,
    applicantEmailVerifiedAt: applicant?.emailVerifiedAt ?? null,
    userCount: tenant._count.users,
    features,
    plans: plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      description: plan.description,
      isActive: plan.isActive,
      features: plan.features.map((row) => ({
        key: row.feature.key,
        enabled: row.enabled,
      })),
    })),
    history: history.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      createdAt: row.createdAt,
      actorName: row.actor?.name ?? null,
    })),
  };
}
