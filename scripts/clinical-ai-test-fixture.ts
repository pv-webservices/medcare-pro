import type { PrismaClient } from "@prisma/client";
import {
  assertPrescriptionTestDatabase,
  createPrescriptionFixture,
} from "./prescription-test-fixture";
export async function createClinicalAiFixture(db: PrismaClient) {
  assertPrescriptionTestDatabase();
  const f = await createPrescriptionFixture(db);
  const feature = await db.feature.update({
    where: { key: "clinical_ai" },
    data: { globalEnabled: true },
  });
  await db.tenantFeatureOverride.create({
    data: {
      tenantId: f.tenant.id,
      featureId: feature.id,
      enabled: true,
      reason: "Disposable synthetic AI test entitlement",
    },
  });
  const assignment = await db.userRole.findFirstOrThrow({
    where: { userId: f.doctorUser.id },
    include: { role: true },
  });
  const originalPermissions = assignment.role.permissions as string[];
  await db.role.update({
    where: { id: assignment.roleId },
    data: {
      permissions: [...originalPermissions, "clinical-ai:writing"],
      featureAccess: { create: { featureId: feature.id, enabled: true } },
    },
  });
  return { ...f, feature, roleId: assignment.roleId, originalPermissions };
}
