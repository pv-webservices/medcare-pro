import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import type { AiConfig } from "./config";
import { AiError } from "./errors";
import { writeAuditLog, AUDIT_ACTIONS } from "@/lib/audit";
import type { AiRunInput } from "./types";
/** A doctor improving every consultation field (8 fields, 2 modes) must not
 * hit the per-user or per-visit limit; the tenant limit bounds cost. */
export const AI_RUN_LIMITS = {
  perUserPerMinute: 12,
  perVisitPerFiveMinutes: 24,
  perTenantPerHour: 100,
} as const;
export async function reserveAiRun(
  actor: ActorContext,
  clinicId: string,
  input: AiRunInput,
  config: AiConfig,
) {
  return prisma.$transaction(
    async (tx) => {
      // Shared DB reservation, so parallel requests/processes cannot bypass limits.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${actor.tenantId} FOR UPDATE`;
      const now = Date.now();
      const [user, visit, tenant] = await Promise.all([
        tx.aiRun.count({
          where: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            createdAt: { gte: new Date(now - 60000) },
          },
        }),
        tx.aiRun.count({
          where: {
            tenantId: actor.tenantId,
            registrationId: input.registrationId,
            createdAt: { gte: new Date(now - 300000) },
          },
        }),
        tx.aiRun.count({
          where: {
            tenantId: actor.tenantId,
            createdAt: { gte: new Date(now - 3600000) },
          },
        }),
      ]);
      if (
        user >= AI_RUN_LIMITS.perUserPerMinute ||
        visit >= AI_RUN_LIMITS.perVisitPerFiveMinutes ||
        tenant >= AI_RUN_LIMITS.perTenantPerHour
      )
        throw new AiError("RATE_LIMIT");
      return tx.aiRun.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          clinicId,
          registrationId: input.registrationId,
          feature: input.feature,
          field: input.field,
          mode: input.mode,
          provider: config.provider,
          model: config.model,
          status: "STARTED",
          inputCharacterCount: input.inputCharacterCount,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function completeAiRun(
  actor: ActorContext,
  runId: string,
  data: {
    status: string;
    outputCharacterCount: number;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  await prisma.$transaction(async (tx) => {
    const run = await tx.aiRun.update({
      where: { id: runId, tenantId: actor.tenantId, userId: actor.userId },
      data,
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINICAL_AI_RUN_COMPLETED,
      targetType: "AiRun",
      targetId: run.id,
      actorTenantId: actor.tenantId,
      actorUserId: actor.userId,
      afterValue: {
        registrationId: run.registrationId,
        clinicId: run.clinicId,
        field: run.field,
        mode: run.mode,
        provider: run.provider,
        model: run.model,
        status: run.status,
      },
    });
  });
}
