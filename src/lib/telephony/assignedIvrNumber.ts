import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import { formatProviderNumberForDisplay } from "@/lib/telephony/phoneNumber";

export interface AssignedIvrNumberView {
  phoneNumber: string | null;
  displayNumber: string | null;
  status: "assigned" | "not-assigned" | "needs-platform-attention";
}

export async function getAssignedIvrNumberForActor(
  actor: ActorContext,
  clinicId: string,
): Promise<AssignedIvrNumberView> {
  await assertActorCanManageTelephony(actor, clinicId);
  const row = await prisma.platformPlivoNumber.findUnique({
    where: { assignedClinicId: clinicId },
    select: {
      phoneNumber: true,
      assignedTenantId: true,
      assignmentStatus: true,
      providerPresent: true,
      healthStatus: true,
      assignedClinic: {
        select: {
          tenantId: true,
          telephonyConfig: { select: { plivoNumber: true } },
        },
      },
    },
  });
  if (!row || row.assignmentStatus !== "ASSIGNED" || row.assignedTenantId !== actor.tenantId) {
    return { phoneNumber: null, displayNumber: null, status: "not-assigned" };
  }
  return {
    phoneNumber: row.phoneNumber,
    displayNumber: formatProviderNumberForDisplay(row.phoneNumber),
    status:
      row.providerPresent && row.healthStatus === "HEALTHY" &&
      row.assignedClinic?.tenantId === actor.tenantId &&
      row.assignedClinic.telephonyConfig?.plivoNumber === row.phoneNumber
        ? "assigned"
        : "needs-platform-attention",
  };
}
