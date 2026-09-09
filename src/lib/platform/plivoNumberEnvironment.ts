import { z } from "zod";

export const DEFAULT_PLIVO_NUMBER_QUARANTINE_DAYS = 14;

export type PlatformPlivoEnvironmentSource = Readonly<
  Record<string, string | undefined>
>;

export interface PlatformPlivoEnvironment {
  readonly authId: string;
  readonly authToken: string;
  readonly expectedApplicationId: string;
  readonly quarantineDays: number;
}

const applicationIdSchema = z.string().trim().regex(/^\d{5,64}$/);

export function resolvePlivoNumberQuarantineDays(
  environment: PlatformPlivoEnvironmentSource = process.env,
): number {
  const parsedDays = Number.parseInt(
    environment.PLIVO_NUMBER_QUARANTINE_DAYS ?? "",
    10,
  );
  return Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 365
    ? parsedDays
    : DEFAULT_PLIVO_NUMBER_QUARANTINE_DAYS;
}

export function resolvePlatformPlivoEnvironment(
  environment: PlatformPlivoEnvironmentSource = process.env,
): PlatformPlivoEnvironment | null {
  const authId = environment.PLIVO_AUTH_ID?.trim() ?? "";
  const authToken = environment.PLIVO_AUTH_TOKEN?.trim() ?? "";
  const expected = applicationIdSchema.safeParse(
    environment.PLIVO_IVR_APPLICATION_ID,
  );
  if (authId === "" || authToken === "" || !expected.success) return null;

  return Object.freeze({
    authId,
    authToken,
    expectedApplicationId: expected.data,
    quarantineDays: resolvePlivoNumberQuarantineDays(environment),
  });
}

export function isPlatformPlivoInventoryAuthoritative(
  environment: PlatformPlivoEnvironmentSource = process.env,
): boolean {
  return environment.PLIVO_NUMBER_INVENTORY_AUTHORITY_ENABLED === "true";
}
