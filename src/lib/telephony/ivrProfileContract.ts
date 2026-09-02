import { z } from "zod";

/**
 * Pure, client-safe contract for the clinic phone menu.
 *
 * This file deliberately has no Prisma, audit, session, or server imports. The
 * management service, runtime compiler, API route, and browser editor all use
 * this one vocabulary so the UI cannot silently accept a profile the live IVR
 * would reject.
 */

export const CLINIC_IVR_MENU_ACTIONS = [
  "TOMORROW_SLOTS",
  "APPOINTMENT_BOOKING",
  "URGENT_ASSISTANCE",
  "CLINIC_INFORMATION",
] as const;
export type ClinicIvrMenuActionValue =
  (typeof CLINIC_IVR_MENU_ACTIONS)[number];

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
export const CLINIC_IVR_BUSINESS_DIGITS = [1, 2, 3, 4, 5, 6, 7] as const;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MARKUP_DELIMITERS = /[<>]/;

export function isClinicIvrPlainText(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value) && !MARKUP_DELIMITERS.test(value);
}

function hasOnlyClinicNamePlaceholder(value: string): boolean {
  return !/[{}]/.test(value.replaceAll("{clinicName}", ""));
}

export const clinicIvrGreetingTemplateSchema = z
  .string()
  .trim()
  .min(1, "Greeting is required.")
  .max(
    CLINIC_IVR_GREETING_MAX_LENGTH,
    `Greeting must be at most ${CLINIC_IVR_GREETING_MAX_LENGTH} characters.`,
  )
  .refine(
    isClinicIvrPlainText,
    "Greeting must be plain text without markup or control characters.",
  )
  .refine(
    hasOnlyClinicNamePlaceholder,
    "Only the {clinicName} placeholder is supported.",
  );

export const clinicIvrMenuLabelSchema = z
  .string()
  .trim()
  .min(1, "Menu label is required.")
  .max(
    CLINIC_IVR_LABEL_MAX_LENGTH,
    `Menu label must be at most ${CLINIC_IVR_LABEL_MAX_LENGTH} characters.`,
  )
  .refine(
    isClinicIvrPlainText,
    "Menu label must be plain text without markup or control characters.",
  );

export const clinicIvrMenuItemSchema = z
  .object({
    digit: z.number().int().min(1).max(7),
    label: clinicIvrMenuLabelSchema,
    action: z.enum(CLINIC_IVR_MENU_ACTIONS),
    position: z.number().int().min(0).max(6),
    enabled: z.boolean(),
  })
  .strict();

export const replaceClinicIvrProfileSchema = z
  .object({
    greetingTemplate: clinicIvrGreetingTemplateSchema,
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
export type ClinicIvrMenuItemInput =
  ReplaceClinicIvrProfileInput["items"][number];

export const DEFAULT_CLINIC_IVR_ITEMS: readonly ClinicIvrMenuItemInput[] =
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

export function renderClinicIvrGreeting(
  greetingTemplate: string,
  clinicName: string,
): string {
  const template = clinicIvrGreetingTemplateSchema.parse(greetingTemplate);
  const normalizedClinicName = clinicName.trim().replace(/\s+/g, " ");
  if (
    normalizedClinicName === "" ||
    !isClinicIvrPlainText(normalizedClinicName)
  ) {
    throw new Error("A plain-text clinic name is required.");
  }
  return template.replaceAll("{clinicName}", normalizedClinicName);
}
