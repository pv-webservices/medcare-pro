import { MAIN_MENU_ROUTES } from "@/lib/telephony/routing";

function normalizeClinicName(clinicName: string): string {
  const normalized = clinicName.trim().replace(/\s+/g, " ");
  if (normalized === "") {
    throw new Error("A clinic name is required for the IVR prompt.");
  }
  return normalized;
}

/** Builds spoken menu text only; it does not generate or expose Plivo XML. */
export function buildMainMenuPrompt(clinicName: string): string {
  const greeting = `Welcome to ${normalizeClinicName(clinicName)}.`;
  const options = Object.entries(MAIN_MENU_ROUTES).map(
    ([digit, route]) => `Press ${digit} ${route.instruction}.`,
  );

  return [greeting, ...options].join(" ");
}
