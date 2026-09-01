import { createHash } from "node:crypto";
import type { ClinicIvrMenuAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildMainMenuPrompt } from "@/lib/telephony/ivr";
import {
  DEFAULT_CLINIC_IVR_ITEMS,
  DEFAULT_CLINIC_IVR_LANGUAGE,
  DEFAULT_CLINIC_IVR_VOICE,
  renderClinicIvrGreeting,
  replaceClinicIvrProfileSchema,
  type PlivoSpeakLanguage,
  type PlivoSpeakVoice,
} from "@/lib/telephony/ivrProfile";
import {
  resolveMainMenuAction,
  type MainMenuAction,
} from "@/lib/telephony/routing";

export const IVR_REVISION_QUERY_PARAM = "ivrRev" as const;
export const IVR_MENU_CHANGED_MESSAGE =
  "Our phone menu has just changed." as const;

export type IvrBusinessAction = Exclude<
  MainMenuAction,
  "repeat-menu" | "invalid-input"
>;

export interface ClinicIvrRuntimeItem {
  readonly digit: number;
  readonly label: string;
  readonly action: IvrBusinessAction;
  readonly position: number;
}

export interface ClinicIvrRuntimeMenu {
  readonly source: "default" | "custom";
  readonly greeting: string;
  readonly prompt: string;
  readonly language: PlivoSpeakLanguage;
  readonly voice: PlivoSpeakVoice;
  readonly items: readonly ClinicIvrRuntimeItem[];
  readonly actionByDigit: Readonly<Record<string, IvrBusinessAction>>;
  readonly revision: string;
}

export type ClinicIvrRuntimeProfileLookup = (
  clinicId: string,
) => Promise<unknown | null>;

const loadRuntimeProfile: ClinicIvrRuntimeProfileLookup = (clinicId) =>
  prisma.clinicIvrProfile.findUnique({
    where: { clinicId },
    select: {
      id: true,
      greetingTemplate: true,
      language: true,
      voice: true,
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

function mapStoredAction(action: ClinicIvrMenuAction): IvrBusinessAction {
  switch (action) {
    case "TOMORROW_SLOTS":
      return "tomorrow-slots";
    case "APPOINTMENT_BOOKING":
      return "appointment-booking";
    case "URGENT_ASSISTANCE":
      return "urgent-assistance";
    case "CLINIC_INFORMATION":
      return "clinic-information";
    default: {
      const unreachable: never = action;
      throw new Error(`Unsupported IVR action: ${String(unreachable)}`);
    }
  }
}

function fingerprint(input: {
  source: "default" | "custom";
  greeting: string;
  language: PlivoSpeakLanguage;
  voice: PlivoSpeakVoice;
  items: readonly ClinicIvrRuntimeItem[];
}): string {
  const canonical = JSON.stringify({
    source: input.source,
    greeting: input.greeting,
    language: input.language,
    voice: input.voice,
    items: input.items.map((item) => [
      item.position,
      item.digit,
      item.label,
      item.action,
    ]),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 32);
}

function freezeRuntimeMenu(input: {
  source: "default" | "custom";
  greeting: string;
  prompt: string;
  language: PlivoSpeakLanguage;
  voice: PlivoSpeakVoice;
  items: readonly ClinicIvrRuntimeItem[];
}): ClinicIvrRuntimeMenu {
  const items = Object.freeze(input.items.map((item) => Object.freeze({ ...item })));
  const actionByDigit = Object.freeze(
    Object.fromEntries(items.map((item) => [String(item.digit), item.action])),
  );
  return Object.freeze({
    ...input,
    items,
    actionByDigit,
    revision: fingerprint({ ...input, items }),
  });
}

export function defaultClinicIvrRuntimeMenu(
  clinicName: string,
): ClinicIvrRuntimeMenu {
  const items = DEFAULT_CLINIC_IVR_ITEMS.map((item) => ({
    digit: item.digit,
    label: item.label,
    action: mapStoredAction(item.action),
    position: item.position,
  }));
  return freezeRuntimeMenu({
    source: "default",
    greeting: `Welcome to ${clinicName.trim().replace(/\s+/g, " ")}.`,
    prompt: buildMainMenuPrompt(clinicName),
    language: DEFAULT_CLINIC_IVR_LANGUAGE,
    voice: DEFAULT_CLINIC_IVR_VOICE,
    items,
  });
}

export function compileCustomClinicIvrRuntimeMenu(
  clinicName: string,
  storedProfile: unknown,
): ClinicIvrRuntimeMenu {
  if (
    typeof storedProfile !== "object" ||
    storedProfile === null ||
    Array.isArray(storedProfile)
  ) {
    throw new Error("Stored IVR profile is malformed.");
  }
  const stored = storedProfile as Record<string, unknown>;
  const profile = replaceClinicIvrProfileSchema.parse({
    greetingTemplate: stored.greetingTemplate,
    language: stored.language,
    voice: stored.voice,
    items: stored.items,
  });
  const greeting = renderClinicIvrGreeting(
    profile.greetingTemplate,
    clinicName,
  );
  const items = profile.items
    .filter((item) => item.enabled)
    .map((item) => ({
      digit: item.digit,
      label: item.label,
      action: mapStoredAction(item.action),
      position: item.position,
    }));
  const prompt = [
    greeting,
    ...items.map((item) => `Press ${item.digit} for ${item.label}.`),
    "Press 9 to repeat these options.",
  ].join(" ");
  return freezeRuntimeMenu({
    source: "custom",
    greeting,
    prompt,
    language: profile.language,
    voice: profile.voice,
    items,
  });
}

function safeProfileId(profile: unknown): string | undefined {
  if (typeof profile !== "object" || profile === null || !("id" in profile)) {
    return undefined;
  }
  return typeof profile.id === "string" ? profile.id : undefined;
}

function logStaticFallback(input: {
  clinicId: string;
  profileId?: string;
  reason: "profile-read-failed" | "profile-validation-failed";
}): void {
  console.error("Falling back to the static clinic IVR menu.", input);
}

/**
 * Runtime-only reader. The clinic must already have been resolved from a
 * successfully verified Plivo `To`; this function never selects call scope.
 */
export async function getClinicIvrRuntimeMenuForTrustedClinic(
  clinic: { readonly clinicId: string; readonly clinicName: string },
  lookup: ClinicIvrRuntimeProfileLookup = loadRuntimeProfile,
): Promise<ClinicIvrRuntimeMenu> {
  let stored: unknown | null;
  try {
    stored = await lookup(clinic.clinicId);
  } catch {
    logStaticFallback({
      clinicId: clinic.clinicId,
      reason: "profile-read-failed",
    });
    return defaultClinicIvrRuntimeMenu(clinic.clinicName);
  }
  if (stored === null) return defaultClinicIvrRuntimeMenu(clinic.clinicName);

  try {
    return compileCustomClinicIvrRuntimeMenu(clinic.clinicName, stored);
  } catch {
    logStaticFallback({
      clinicId: clinic.clinicId,
      profileId: safeProfileId(stored),
      reason: "profile-validation-failed",
    });
    return defaultClinicIvrRuntimeMenu(clinic.clinicName);
  }
}

export function resolveRuntimeMainMenuAction(
  menu: ClinicIvrRuntimeMenu,
  digits: string | null | undefined,
): MainMenuAction {
  if (menu.source === "default") return resolveMainMenuAction(digits);
  if (digits === "9") return "repeat-menu";
  return digits ? (menu.actionByDigit[digits] ?? "invalid-input") : "invalid-input";
}
