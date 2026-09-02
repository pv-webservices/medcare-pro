import type { Prisma } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";
import {
  DEFAULT_CLINIC_IVR_GREETING_TEMPLATE,
  DEFAULT_CLINIC_IVR_ITEMS,
  DEFAULT_CLINIC_IVR_LANGUAGE,
  DEFAULT_CLINIC_IVR_VOICE,
  type ClinicIvrMenuActionValue,
  type PlivoSpeakLanguage,
  type PlivoSpeakVoice,
  type ReplaceClinicIvrProfileInput,
} from "@/lib/telephony/ivrProfileContract";

export * from "@/lib/telephony/ivrProfileContract";

export interface ClinicIvrMenuItemView {
  digit: number;
  label: string;
  action: ClinicIvrMenuActionValue;
  position: number;
  enabled: boolean;
}

export interface ClinicIvrProfileView {
  clinicId: string;
  source: "default" | "custom";
  greetingTemplate: string;
  language: PlivoSpeakLanguage;
  voice: PlivoSpeakVoice;
  items: readonly ClinicIvrMenuItemView[];
  updatedAt: Date | null;
}

export function defaultClinicIvrProfile(
  clinicId: string,
): ClinicIvrProfileView {
  return Object.freeze({
    clinicId,
    source: "default",
    greetingTemplate: DEFAULT_CLINIC_IVR_GREETING_TEMPLATE,
    language: DEFAULT_CLINIC_IVR_LANGUAGE,
    voice: DEFAULT_CLINIC_IVR_VOICE,
    items: DEFAULT_CLINIC_IVR_ITEMS,
    updatedAt: null,
  });
}

interface StoredClinicIvrProfile {
  id: string;
  clinicId: string;
  greetingTemplate: string;
  language: string;
  voice: string;
  updatedAt: Date;
  items: Array<{
    digit: number;
    label: string;
    action: ClinicIvrMenuActionValue;
    position: number;
    enabled: boolean;
  }>;
}

type IvrProfileClient = Pick<Prisma.TransactionClient, "clinicIvrProfile">;

function loadStoredProfile(
  client: IvrProfileClient,
  clinicId: string,
): Promise<StoredClinicIvrProfile | null> {
  return client.clinicIvrProfile.findUnique({
    where: { clinicId },
    select: {
      id: true,
      clinicId: true,
      greetingTemplate: true,
      language: true,
      voice: true,
      updatedAt: true,
      items: {
        orderBy: [{ position: "asc" }, { digit: "asc" }],
        select: {
          digit: true,
          label: true,
          action: true,
          position: true,
          enabled: true,
        },
      },
    },
  });
}

function toCustomView(profile: StoredClinicIvrProfile): ClinicIvrProfileView {
  return Object.freeze({
    clinicId: profile.clinicId,
    source: "custom",
    greetingTemplate: profile.greetingTemplate,
    language: profile.language as PlivoSpeakLanguage,
    voice: profile.voice as PlivoSpeakVoice,
    items: Object.freeze(profile.items.map((item) => Object.freeze({ ...item }))),
    updatedAt: profile.updatedAt,
  });
}

function itemMatches(
  stored: ClinicIvrMenuItemView,
  input: ClinicIvrMenuItemView,
): boolean {
  return (
    stored.digit === input.digit &&
    stored.label === input.label &&
    stored.action === input.action &&
    stored.position === input.position &&
    stored.enabled === input.enabled
  );
}

function profileMatches(
  stored: StoredClinicIvrProfile,
  input: ReplaceClinicIvrProfileInput,
): boolean {
  return (
    stored.greetingTemplate === input.greetingTemplate &&
    stored.language === input.language &&
    stored.voice === input.voice &&
    stored.items.length === input.items.length &&
    stored.items.every((item, index) => itemMatches(item, input.items[index]))
  );
}

function changedFields(
  stored: StoredClinicIvrProfile | null,
  input: ReplaceClinicIvrProfileInput,
): string[] {
  if (!stored) return ["greetingTemplate", "language", "voice", "items"];
  const changed: string[] = [];
  if (stored.greetingTemplate !== input.greetingTemplate) {
    changed.push("greetingTemplate");
  }
  if (stored.language !== input.language) changed.push("language");
  if (stored.voice !== input.voice) changed.push("voice");
  if (
    stored.items.length !== input.items.length ||
    !stored.items.every((item, index) => itemMatches(item, input.items[index]))
  ) {
    changed.push("items");
  }
  return changed;
}

function auditFacts(input: ReplaceClinicIvrProfileInput) {
  return {
    menuItemCount: input.items.length,
    enabledActions: input.items
      .filter((item) => item.enabled)
      .map((item) => item.action),
    digits: input.items.map((item) => item.digit),
  };
}

export async function getClinicIvrProfileForActor(
  actor: ActorContext,
  clinicId: string,
): Promise<ClinicIvrProfileView> {
  await assertActorCanManageTelephony(actor, clinicId);
  const stored = await loadStoredProfile(prisma, clinicId);
  return stored ? toCustomView(stored) : defaultClinicIvrProfile(clinicId);
}

export async function replaceClinicIvrProfileForActor(
  actor: ActorContext,
  clinicId: string,
  input: ReplaceClinicIvrProfileInput,
): Promise<ClinicIvrProfileView> {
  await assertActorCanManageTelephony(actor, clinicId);

  return prisma.$transaction(async (tx) => {
    const existing = await loadStoredProfile(tx, clinicId);
    if (existing && profileMatches(existing, input)) {
      return toCustomView(existing);
    }

    const saved = await tx.clinicIvrProfile.upsert({
      where: { clinicId },
      create: {
        clinicId,
        greetingTemplate: input.greetingTemplate,
        language: input.language,
        voice: input.voice,
      },
      update: {
        greetingTemplate: input.greetingTemplate,
        language: input.language,
        voice: input.voice,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        clinicId: true,
        greetingTemplate: true,
        language: true,
        voice: true,
        updatedAt: true,
      },
    });

    await tx.clinicIvrMenuItem.deleteMany({
      where: { profileId: saved.id },
    });
    await tx.clinicIvrMenuItem.createMany({
      data: input.items.map((item) => ({ profileId: saved.id, ...item })),
    });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_IVR_PROFILE_UPDATED,
      targetType: "ClinicIvrProfile",
      targetId: saved.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: {
        clinicId,
        changedFields: changedFields(existing, input),
        ...auditFacts(input),
      },
    });

    return toCustomView({ ...saved, items: input.items });
  });
}

export async function resetClinicIvrProfileForActor(
  actor: ActorContext,
  clinicId: string,
): Promise<ClinicIvrProfileView> {
  await assertActorCanManageTelephony(actor, clinicId);

  await prisma.$transaction(async (tx) => {
    const existing = await loadStoredProfile(tx, clinicId);
    if (!existing) return;

    await tx.clinicIvrProfile.delete({ where: { id: existing.id } });
    await writeAuditLog(tx, {
      action: AUDIT_ACTIONS.CLINIC_IVR_PROFILE_RESET,
      targetType: "ClinicIvrProfile",
      targetId: existing.id,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      afterValue: {
        clinicId,
        removedMenuItemCount: existing.items.length,
        enabledActions: existing.items
          .filter((item) => item.enabled)
          .map((item) => item.action),
        digits: existing.items.map((item) => item.digit),
      },
    });
  });

  return defaultClinicIvrProfile(clinicId);
}
