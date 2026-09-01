import type {
  ClinicIvrMenuAction,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { ActorContext } from "@/lib/rbac";
import { assertActorCanManageTelephony } from "@/lib/telephony/access";

export const CLINIC_IVR_MENU_ACTIONS = [
  "TOMORROW_SLOTS",
  "APPOINTMENT_BOOKING",
  "URGENT_ASSISTANCE",
  "CLINIC_INFORMATION",
] as const satisfies readonly ClinicIvrMenuAction[];

export const PLIVO_SPEAK_VOICES = ["WOMAN", "MAN"] as const;
export type PlivoSpeakVoice = (typeof PLIVO_SPEAK_VOICES)[number];

export const PLIVO_SPEAK_LANGUAGES = [
  "arb",
  "cmn-CN",
  "da-DK",
  "nl-NL",
  "en-AU",
  "en-IN",
  "en-GB",
  "en-US",
  "fr-CA",
  "fr-FR",
  "de-DE",
  "hi-IN",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "pt-PT",
  "ru-RU",
  "es-MX",
  "es-ES",
  "es-US",
] as const;
export type PlivoSpeakLanguage = (typeof PLIVO_SPEAK_LANGUAGES)[number];

/** Current plain Speak language/voice compatibility from Plivo documentation. */
export const PLIVO_SPEAK_LANGUAGE_VOICES = {
  arb: ["WOMAN"],
  "cmn-CN": ["WOMAN"],
  "da-DK": ["WOMAN", "MAN"],
  "nl-NL": ["WOMAN", "MAN"],
  "en-AU": ["WOMAN", "MAN"],
  "en-IN": ["WOMAN"],
  "en-GB": ["WOMAN", "MAN"],
  "en-US": ["WOMAN", "MAN"],
  "fr-CA": ["WOMAN"],
  "fr-FR": ["WOMAN", "MAN"],
  "de-DE": ["WOMAN", "MAN"],
  "hi-IN": ["WOMAN"],
  "it-IT": ["WOMAN", "MAN"],
  "ja-JP": ["WOMAN", "MAN"],
  "ko-KR": ["WOMAN"],
  "pt-BR": ["WOMAN", "MAN"],
  "pt-PT": ["WOMAN", "MAN"],
  "ru-RU": ["WOMAN", "MAN"],
  "es-MX": ["WOMAN"],
  "es-ES": ["WOMAN", "MAN"],
  "es-US": ["WOMAN", "MAN"],
} as const satisfies Readonly<
  Record<PlivoSpeakLanguage, readonly PlivoSpeakVoice[]>
>;

export const DEFAULT_CLINIC_IVR_GREETING_TEMPLATE =
  "Welcome to {clinicName}.";
export const DEFAULT_CLINIC_IVR_LANGUAGE: PlivoSpeakLanguage = "en-US";
export const DEFAULT_CLINIC_IVR_VOICE: PlivoSpeakVoice = "WOMAN";
export const CLINIC_IVR_GREETING_MAX_LENGTH = 500;
export const CLINIC_IVR_LABEL_MAX_LENGTH = 80;
export const CLINIC_IVR_MAX_MENU_ITEMS = 7;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MARKUP_DELIMITERS = /[<>]/;

function isPlainText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value) && !MARKUP_DELIMITERS.test(value);
}

function hasOnlyClinicNamePlaceholder(value: string): boolean {
  return !/[{}]/.test(value.replaceAll("{clinicName}", ""));
}

const greetingTemplateSchema = z
  .string()
  .trim()
  .min(1, "Greeting is required.")
  .max(
    CLINIC_IVR_GREETING_MAX_LENGTH,
    `Greeting must be at most ${CLINIC_IVR_GREETING_MAX_LENGTH} characters.`,
  )
  .refine(isPlainText, "Greeting must be plain text without markup or control characters.")
  .refine(
    hasOnlyClinicNamePlaceholder,
    "Only the {clinicName} placeholder is supported.",
  );

const menuLabelSchema = z
  .string()
  .trim()
  .min(1, "Menu label is required.")
  .max(
    CLINIC_IVR_LABEL_MAX_LENGTH,
    `Menu label must be at most ${CLINIC_IVR_LABEL_MAX_LENGTH} characters.`,
  )
  .refine(isPlainText, "Menu label must be plain text without markup or control characters.");

const clinicIvrMenuItemSchema = z
  .object({
    digit: z.number().int().min(1).max(7),
    label: menuLabelSchema,
    action: z.enum(CLINIC_IVR_MENU_ACTIONS),
    position: z.number().int().min(0).max(6),
    enabled: z.boolean(),
  })
  .strict();

export const replaceClinicIvrProfileSchema = z
  .object({
    greetingTemplate: greetingTemplateSchema,
    language: z.enum(PLIVO_SPEAK_LANGUAGES),
    voice: z.enum(PLIVO_SPEAK_VOICES),
    items: z
      .array(clinicIvrMenuItemSchema)
      .min(1, "At least one business menu item is required.")
      .max(
        CLINIC_IVR_MAX_MENU_ITEMS,
        `At most ${CLINIC_IVR_MAX_MENU_ITEMS} business menu items are allowed.`,
      ),
  })
  .strict()
  .superRefine((input, context) => {
    const uniqueness: readonly (readonly [string, readonly unknown[]])[] = [
      ["digit", input.items.map((item) => item.digit)],
      ["action", input.items.map((item) => item.action)],
      ["position", input.items.map((item) => item.position)],
    ];
    for (const [field, values] of uniqueness) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: `Each menu item must have a unique ${field}.`,
        });
      }
    }

    if (!input.items.some((item) => item.enabled)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "At least one business action must be enabled.",
      });
    }

    const allowedVoices = PLIVO_SPEAK_LANGUAGE_VOICES[input.language];
    if (!(allowedVoices as readonly string[]).includes(input.voice)) {
      context.addIssue({
        code: "custom",
        path: ["voice"],
        message: `${input.voice} is not supported for ${input.language}.`,
      });
    }
  })
  .transform((input) => ({
    ...input,
    items: [...input.items].sort((left, right) => left.position - right.position),
  }));

export type ReplaceClinicIvrProfileInput = z.infer<
  typeof replaceClinicIvrProfileSchema
>;

export interface ClinicIvrMenuItemView {
  digit: number;
  label: string;
  action: ClinicIvrMenuAction;
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

export const DEFAULT_CLINIC_IVR_ITEMS: readonly ClinicIvrMenuItemView[] =
  Object.freeze([
    Object.freeze({
      digit: 1,
      label: "tomorrow slots",
      action: "TOMORROW_SLOTS" as const,
      position: 0,
      enabled: true,
    }),
    Object.freeze({
      digit: 2,
      label: "appointment booking",
      action: "APPOINTMENT_BOOKING" as const,
      position: 1,
      enabled: true,
    }),
    Object.freeze({
      digit: 3,
      label: "urgent assistance",
      action: "URGENT_ASSISTANCE" as const,
      position: 2,
      enabled: true,
    }),
    Object.freeze({
      digit: 4,
      label: "clinic information",
      action: "CLINIC_INFORMATION" as const,
      position: 3,
      enabled: true,
    }),
  ]);

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

export function renderClinicIvrGreeting(
  greetingTemplate: string,
  clinicName: string,
): string {
  const template = greetingTemplateSchema.parse(greetingTemplate);
  const normalizedClinicName = clinicName.trim().replace(/\s+/g, " ");
  if (normalizedClinicName === "" || !isPlainText(normalizedClinicName)) {
    throw new Error("A plain-text clinic name is required.");
  }
  return template.replaceAll("{clinicName}", normalizedClinicName);
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
    action: ClinicIvrMenuAction;
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
