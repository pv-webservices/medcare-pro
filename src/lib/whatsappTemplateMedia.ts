import { prisma } from "@/lib/prisma";
import {
  can,
  requirePermission,
  assertClinicInTenant,
  ScopeError,
  type ActorContext,
} from "@/lib/rbac";
import type { SafeMediaAsset } from "@/lib/mediaTypes";

export interface TemplateMediaRecord {
  templateId: string;
  clinicId: string;
  mediaAsset: SafeMediaAsset;
}

/**
 * Binds a clinic-specific media asset to an account-wide message template.
 */
export async function bindTemplateMedia(
  actor: ActorContext,
  input: {
    templateId: string;
    clinicId: string;
    mediaAssetId: string;
  },
): Promise<TemplateMediaRecord> {
  await requirePermission(actor, "message:template", input.clinicId);

  // Assert template belongs to caller's tenant
  const template = await prisma.whatsappTemplate.findFirst({
    where: { id: input.templateId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!template) {
    throw new ScopeError();
  }

  // Assert media asset belongs to caller's tenant and the specified clinic
  const mediaAsset = await prisma.mediaAsset.findFirst({
    where: {
      id: input.mediaAssetId,
      tenantId: actor.tenantId,
      clinicId: input.clinicId,
      deletedAt: null,
    },
    select: {
      id: true,
      clinicId: true,
      originalFileName: true,
      mimeType: true,
      mediaType: true,
      fileSize: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  if (!mediaAsset) {
    throw new ScopeError();
  }

  const record = await prisma.whatsappTemplateMedia.upsert({
    where: {
      templateId_clinicId: {
        templateId: input.templateId,
        clinicId: input.clinicId,
      },
    },
    create: {
      tenantId: actor.tenantId,
      clinicId: input.clinicId,
      templateId: input.templateId,
      mediaAssetId: input.mediaAssetId,
    },
    update: {
      mediaAssetId: input.mediaAssetId,
    },
    include: {
      mediaAsset: {
        select: {
          id: true,
          clinicId: true,
          originalFileName: true,
          mimeType: true,
          mediaType: true,
          fileSize: true,
          createdAt: true,
          lastUsedAt: true,
        },
      },
    },
  });

  return {
    templateId: record.templateId,
    clinicId: record.clinicId,
    mediaAsset: record.mediaAsset,
  };
}

/**
 * Removes the clinic-specific media attachment from a template.
 * The underlying MediaAsset is preserved.
 */
export async function removeTemplateMedia(
  actor: ActorContext,
  input: {
    templateId: string;
    clinicId: string;
  },
): Promise<{ removed: true }> {
  await requirePermission(actor, "message:template", input.clinicId);

  // Assert template belongs to caller's tenant
  const template = await prisma.whatsappTemplate.findFirst({
    where: { id: input.templateId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!template) {
    throw new ScopeError();
  }

  await prisma.whatsappTemplateMedia.deleteMany({
    where: {
      templateId: input.templateId,
      clinicId: input.clinicId,
      tenantId: actor.tenantId,
    },
  });

  return { removed: true };
}

/**
 * Gets the media attachment for a specific template in a clinic.
 */
export async function getTemplateMediaForClinic(
  actor: ActorContext,
  templateId: string,
  clinicId: string,
): Promise<SafeMediaAsset | null> {
  await assertClinicInTenant(actor.tenantId, clinicId);

  const [canTemplate, canSend] = await Promise.all([
    can(actor, "message:template", clinicId),
    can(actor, "message:send", clinicId),
  ]);
  if (!canTemplate && !canSend) {
    throw new ScopeError();
  }

  const record = await prisma.whatsappTemplateMedia.findUnique({
    where: {
      templateId_clinicId: {
        templateId,
        clinicId,
      },
    },
    include: {
      mediaAsset: {
        select: {
          id: true,
          clinicId: true,
          originalFileName: true,
          mimeType: true,
          mediaType: true,
          fileSize: true,
          createdAt: true,
          lastUsedAt: true,
        },
      },
    },
  });

  if (!record || record.tenantId !== actor.tenantId) {
    return null;
  }

  return record.mediaAsset;
}

/**
 * Lists all template media attachments for a clinic.
 */
export async function listTemplateMediaForClinic(
  actor: ActorContext,
  clinicId: string,
): Promise<Record<string, SafeMediaAsset>> {
  await assertClinicInTenant(actor.tenantId, clinicId);

  const [canTemplate, canSend] = await Promise.all([
    can(actor, "message:template", clinicId),
    can(actor, "message:send", clinicId),
  ]);
  if (!canTemplate && !canSend) {
    throw new ScopeError();
  }

  const records = await prisma.whatsappTemplateMedia.findMany({
    where: {
      tenantId: actor.tenantId,
      clinicId,
    },
    include: {
      mediaAsset: {
        select: {
          id: true,
          clinicId: true,
          originalFileName: true,
          mimeType: true,
          mediaType: true,
          fileSize: true,
          createdAt: true,
          lastUsedAt: true,
        },
      },
    },
  });

  const map: Record<string, SafeMediaAsset> = {};
  for (const record of records) {
    map[record.templateId] = record.mediaAsset;
  }
  return map;
}
