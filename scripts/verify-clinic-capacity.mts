/**
 * Database-backed clinic-capacity and concurrency verification.
 *
 * Refuses every non-local database because it creates disposable tenants,
 * clinics, requests, grants, notifications and audit rows.
 *
 *   npm run verify:clinic-capacity
 */
import "dotenv/config";
import { ConflictError } from "@/lib/apiHandler";
import { ClinicLimitReachedError } from "@/lib/clinicCapacityErrors";
import { resolveClinicCapacity } from "@/lib/clinicCapacity";
import { submitClinicCapacityRequest } from "@/lib/clinicCapacityRequests";
import { createClinic } from "@/lib/clinics";
import { seedDefaultRoles } from "@/lib/defaultRoles";
import { seedFeatureCatalogue } from "@/lib/defaultFeatures";
import { prisma } from "@/lib/prisma";
import { PermissionError, type ActorContext } from "@/lib/rbac";
import type { PlatformActorContext } from "@/lib/platform/context";
import {
  approveClinicCapacityRequest,
  setClinicCapacityPayment,
} from "@/lib/platform/clinicCapacity";

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseHost = (() => { try { return new URL(databaseUrl).hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1"].includes(databaseHost)) {
  console.error("Refusing to run: DATABASE_URL does not point at a local database.");
  process.exit(1);
}

const stamp = Date.now();
const tenantName = `verify-clinic-capacity-${stamp}`;
const planKey = `verify-clinic-capacity-${stamp}`;
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures += 1; console.error(`  FAIL  ${label}`, detail ?? ""); }
}

async function main() {
  await seedFeatureCatalogue(prisma);
  const clinicFeature = await prisma.feature.findUniqueOrThrow({
    where: { key: "clinics" },
    select: { id: true },
  });
  const plan = await prisma.plan.create({
    data: { key: planKey, name: "Capacity verification", includedClinics: 2 },
    select: { id: true },
  });
  await prisma.planFeature.create({ data: { planId: plan.id, featureId: clinicFeature.id, enabled: true } });
  const tenant = await prisma.tenant.create({ data: { businessName: tenantName, email: `${tenantName}@example.test`, slug: tenantName, emailVerifiedAt: new Date(), status: "ACTIVE", planId: plan.id }, select: { id: true } });
  await seedDefaultRoles(prisma, tenant.id);
  const roles = await prisma.role.findMany({ where: { tenantId: tenant.id }, select: { id: true, key: true } });
  const ownerRole = roles.find((role) => role.key === "OWNER")!;
  const doctorRole = roles.find((role) => role.key === "DOCTOR")!;
  const ownerUser = await prisma.user.create({ data: { tenantId: tenant.id, name: "Capacity Owner", email: `capacity-owner-${stamp}@example.test`, passwordHash: "x", emailVerifiedAt: new Date(), accountStatus: "ACTIVE", membershipStatus: "ACTIVE", userRoles: { create: [{ roleId: ownerRole.id }] } }, select: { id: true } });
  const platformUser = await prisma.user.create({ data: { tenantId: tenant.id, name: "Capacity Platform Owner", email: `capacity-platform-${stamp}@example.test`, passwordHash: "x", emailVerifiedAt: new Date(), accountStatus: "ACTIVE", membershipStatus: "ACTIVE", platformRole: "SUPER_ADMIN" }, select: { id: true } });
  const actor: ActorContext = { tenantId: tenant.id, userId: ownerUser.id };
  const platform: PlatformActorContext = { userId: platformUser.id, platformRole: "SUPER_ADMIN", sessionId: "verify-clinic-capacity" };

  await createClinic(actor, { name: "Clinic 1" });
  const simultaneous = await Promise.allSettled([
    createClinic(actor, { name: "Clinic 2A" }),
    createClinic(actor, { name: "Clinic 2B" }),
  ]);
  check("simultaneous creation leaves exactly two clinics", (await prisma.clinic.count({ where: { tenantId: tenant.id } })) === 2);
  check("one simultaneous create succeeds", simultaneous.filter((result) => result.status === "fulfilled").length === 1, simultaneous);
  check("one simultaneous create receives CLINIC_LIMIT_REACHED", simultaneous.some((result) => result.status === "rejected" && result.reason instanceof ClinicLimitReachedError), simultaneous);

  const scopedUser = await prisma.user.create({ data: { tenantId: tenant.id, name: "Scoped", email: `capacity-scoped-${stamp}@example.test`, passwordHash: "x", emailVerifiedAt: new Date(), accountStatus: "ACTIVE", membershipStatus: "ACTIVE" }, select: { id: true } });
  const clinicId = (await prisma.clinic.findFirstOrThrow({ where: { tenantId: tenant.id }, select: { id: true } })).id;
  await prisma.userRole.create({ data: { userId: scopedUser.id, roleId: ownerRole.id, clinicId } });
  try {
    await submitClinicCapacityRequest({ tenantId: tenant.id, userId: scopedUser.id }, { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 });
    check("clinic-scoped role cannot request organization capacity", false);
  } catch (error) {
    check("clinic-scoped role cannot request organization capacity", error instanceof PermissionError);
  }

  const doctorUser = await prisma.user.create({ data: { tenantId: tenant.id, name: "Doctor", email: `capacity-doctor-${stamp}@example.test`, passwordHash: "x", emailVerifiedAt: new Date(), accountStatus: "ACTIVE", membershipStatus: "ACTIVE", userRoles: { create: [{ roleId: doctorRole.id, clinicId }] } }, select: { id: true } });
  try {
    await submitClinicCapacityRequest({ tenantId: tenant.id, userId: doctorUser.id }, { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1 });
    check("Doctor cannot request organization capacity", false);
  } catch (error) {
    check("Doctor cannot request organization capacity", error instanceof PermissionError);
  }

  const request = await submitClinicCapacityRequest(actor, { requestType: "ADDITIONAL_CLINIC", requestedQuantity: 1, paymentReference: "disposable-test-reference" });
  try {
    await approveClinicCapacityRequest(platform, request.id, { confirmation: request.id });
    check("submitted payment reference is not payment confirmation", false);
  } catch (error) {
    check("submitted payment reference is not payment confirmation", error instanceof ConflictError);
  }
  await setClinicCapacityPayment(platform, request.id, { paymentStatus: "CONFIRMED", reviewNote: "Disposable local verification." });
  const approvals = await Promise.all([
    approveClinicCapacityRequest(platform, request.id, { confirmation: request.id, reviewNote: "Disposable local verification." }),
    approveClinicCapacityRequest(platform, request.id, { confirmation: request.id, reviewNote: "Disposable concurrent verification." }),
  ]);
  check("approval creates one slot", approvals.every((approved) => approved.quantity === 1));
  check("simultaneous double approval is idempotent", approvals.filter((approved) => approved.alreadyApproved).length === 1 && (await prisma.tenantClinicCapacityGrant.count({ where: { sourceRequestId: request.id } })) === 1);
  check("approval unlocks 2/3", (await resolveClinicCapacity(tenant.id)).effectiveLimit === 3);
  await createClinic(actor, { name: "Clinic 3" });
  try {
    await createClinic(actor, { name: "Clinic 4" });
    check("3/3 re-blocks creation", false);
  } catch (error) {
    check("3/3 re-blocks creation", error instanceof ClinicLimitReachedError);
  }
}

main()
  .catch((error) => { failures += 1; console.error("Verification failed:", error); })
  .finally(async () => {
    const tenants = await prisma.tenant.findMany({ where: { businessName: tenantName }, select: { id: true } });
    const tenantIds = tenants.map((tenant) => tenant.id);
    const userIds = (await prisma.user.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true } })).map((user) => user.id);
    await prisma.notification.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorTenantId: { in: tenantIds } }, { actorUserId: { in: userIds } }] } });
    await prisma.tenantClinicCapacityGrant.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicCapacityRequest.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await prisma.plan.deleteMany({ where: { key: planKey } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  });
