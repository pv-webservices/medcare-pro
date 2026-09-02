import {
  CLINIC_IVR_BUSINESS_DIGITS,
  CLINIC_IVR_MENU_ACTIONS,
  DEFAULT_CLINIC_IVR_ITEMS,
  PLIVO_SPEAK_LANGUAGE_VOICES,
  replaceClinicIvrProfileSchema,
  type ClinicIvrMenuActionValue,
  type ClinicIvrMenuItemInput,
  type PlivoSpeakLanguage,
  type PlivoSpeakVoice,
  type ReplaceClinicIvrProfileInput,
} from "@/lib/telephony/ivrProfileContract";

/** Browser-safe profile shape returned by the IVR profile API. */
export interface PhoneMenuProfile {
  clinicId: string;
  source: "default" | "custom";
  greetingTemplate: string;
  language: PlivoSpeakLanguage;
  voice: PlivoSpeakVoice;
  items: readonly ClinicIvrMenuItemInput[];
  updatedAt: string | null;
}

export type PhoneMenuDraft = ReplaceClinicIvrProfileInput;

export const PHONE_MENU_ACTION_LABELS: Readonly<
  Record<ClinicIvrMenuActionValue, string>
> = {
  TOMORROW_SLOTS: "Tomorrow's availability",
  APPOINTMENT_BOOKING: "Book an appointment",
  URGENT_ASSISTANCE: "Urgent assistance",
  CLINIC_INFORMATION: "Clinic information",
};

export const PHONE_MENU_LANGUAGE_LABELS: Readonly<
  Record<PlivoSpeakLanguage, string>
> = {
  arb: "Arabic",
  "cmn-CN": "Chinese, Mandarin",
  "da-DK": "Danish (Denmark)",
  "nl-NL": "Dutch (Netherlands)",
  "en-AU": "English (Australia)",
  "en-IN": "English (India)",
  "en-GB": "English (United Kingdom)",
  "en-US": "English (United States)",
  "fr-CA": "French (Canada)",
  "fr-FR": "French (France)",
  "de-DE": "German (Germany)",
  "hi-IN": "Hindi (India)",
  "it-IT": "Italian (Italy)",
  "ja-JP": "Japanese (Japan)",
  "ko-KR": "Korean (South Korea)",
  "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)",
  "ru-RU": "Russian (Russia)",
  "es-MX": "Spanish (Mexico)",
  "es-ES": "Spanish (Spain)",
  "es-US": "Spanish (United States)",
};

export const PHONE_MENU_VOICE_LABELS: Readonly<
  Record<PlivoSpeakVoice, string>
> = {
  WOMAN: "Woman",
  MAN: "Man",
};

const DEFAULT_LABEL_BY_ACTION = Object.fromEntries(
  DEFAULT_CLINIC_IVR_ITEMS.map((item) => [item.action, item.label]),
) as Record<ClinicIvrMenuActionValue, string>;

function cloneItems(
  items: readonly ClinicIvrMenuItemInput[],
): ClinicIvrMenuItemInput[] {
  return [...items]
    .sort((left, right) => left.position - right.position)
    .map((item, position) => ({ ...item, position }));
}

function renumberItems(
  items: readonly ClinicIvrMenuItemInput[],
): ClinicIvrMenuItemInput[] {
  return items.map((item, position) => ({ ...item, position }));
}

export function profileToPhoneMenuDraft(
  profile: PhoneMenuProfile,
): PhoneMenuDraft {
  return {
    greetingTemplate: profile.greetingTemplate,
    language: profile.language,
    voice: profile.voice,
    items: cloneItems(profile.items),
  };
}

function comparableDraft(draft: PhoneMenuDraft): string {
  return JSON.stringify({
    greetingTemplate: draft.greetingTemplate,
    language: draft.language,
    voice: draft.voice,
    items: cloneItems(draft.items),
  });
}

export function isPhoneMenuDraftDirty(
  draft: PhoneMenuDraft,
  profile: PhoneMenuProfile,
): boolean {
  return comparableDraft(draft) !== comparableDraft(profileToPhoneMenuDraft(profile));
}

export interface PhoneMenuValidationResult {
  valid: boolean;
  errors: Readonly<Record<string, string>>;
  formError: string | null;
}

export function validatePhoneMenuDraft(
  draft: PhoneMenuDraft,
): PhoneMenuValidationResult {
  const result = replaceClinicIvrProfileSchema.safeParse(draft);
  if (result.success) {
    return { valid: true, errors: {}, formError: null };
  }

  const errors: Record<string, string> = {};
  let formError: string | null = null;
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join(".");
    if (key === "items" || key === "") {
      formError ??= issue.message;
    } else {
      errors[key] ??= issue.message;
    }
  }
  return { valid: false, errors, formError };
}

/** Normalized, strict payload for PUT. Scope identifiers never enter this shape. */
export function phoneMenuPutPayload(
  draft: PhoneMenuDraft,
): ReplaceClinicIvrProfileInput {
  return replaceClinicIvrProfileSchema.parse(draft);
}

export function changePhoneMenuLanguage(
  draft: PhoneMenuDraft,
  language: PlivoSpeakLanguage,
): PhoneMenuDraft {
  const allowed = PLIVO_SPEAK_LANGUAGE_VOICES[language];
  const voice = (allowed as readonly PlivoSpeakVoice[]).includes(draft.voice)
    ? draft.voice
    : allowed[0];
  return { ...draft, language, voice };
}

export function updatePhoneMenuItem(
  draft: PhoneMenuDraft,
  index: number,
  patch: Partial<ClinicIvrMenuItemInput>,
): PhoneMenuDraft {
  return {
    ...draft,
    items: draft.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : { ...item },
    ),
  };
}

export function movePhoneMenuItem(
  draft: PhoneMenuDraft,
  index: number,
  direction: -1 | 1,
): PhoneMenuDraft {
  const target = index + direction;
  if (index < 0 || index >= draft.items.length || target < 0 || target >= draft.items.length) {
    return draft;
  }
  const items = cloneItems(draft.items);
  [items[index], items[target]] = [items[target]!, items[index]!];
  return { ...draft, items: renumberItems(items) };
}

export function removePhoneMenuItem(
  draft: PhoneMenuDraft,
  index: number,
): PhoneMenuDraft {
  if (draft.items.length <= 1 || index < 0 || index >= draft.items.length) {
    return draft;
  }
  return {
    ...draft,
    items: cloneItems(draft.items.filter((_, itemIndex) => itemIndex !== index)),
  };
}

export function addPhoneMenuItem(draft: PhoneMenuDraft): PhoneMenuDraft {
  const usedActions = new Set(draft.items.map((item) => item.action));
  const usedDigits = new Set(draft.items.map((item) => item.digit));
  const action = CLINIC_IVR_MENU_ACTIONS.find(
    (candidate) => !usedActions.has(candidate),
  );
  const digit = CLINIC_IVR_BUSINESS_DIGITS.find(
    (candidate) => !usedDigits.has(candidate),
  );
  if (!action || digit === undefined) return draft;

  return {
    ...draft,
    items: [
      ...cloneItems(draft.items),
      {
        digit,
        label: DEFAULT_LABEL_BY_ACTION[action],
        action,
        position: draft.items.length,
        enabled: true,
      },
    ],
  };
}

export function canAddPhoneMenuItem(draft: PhoneMenuDraft): boolean {
  return draft.items.length < CLINIC_IVR_MENU_ACTIONS.length;
}

export interface PhoneMenuPreview {
  greeting: string;
  options: readonly string[];
  repeat: string;
}

export function buildPhoneMenuPreview(
  draft: PhoneMenuDraft,
  clinicName: string,
): PhoneMenuPreview {
  const normalizedClinicName = clinicName.trim().replace(/\s+/g, " ");
  return {
    greeting: draft.greetingTemplate.replaceAll(
      "{clinicName}",
      normalizedClinicName,
    ),
    options: cloneItems(draft.items)
      .filter((item) => item.enabled)
      .map((item) => `Press ${item.digit} for ${item.label}.`),
    repeat: "Press 9 to repeat these options.",
  };
}
