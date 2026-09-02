import { configuredPhoneNumberSchema } from "@/lib/telephony/phoneNumber";

export const PLIVO_TEST_CALL_DESTINATION_ENV =
  "PLIVO_TEST_CALL_DESTINATION" as const;

export type TelephonyTestCallEnvironmentSource = Readonly<
  Record<string, string | undefined>
>;

export interface TelephonyTestCallEnvironment {
  readonly authId: string;
  readonly authToken: string;
  readonly destination: string;
  readonly destinationLast4: string;
  readonly destinationLabel: string;
}

/** Server-only deployment configuration. Failure is deliberately non-specific. */
export function resolveTelephonyTestCallEnvironment(
  environment: TelephonyTestCallEnvironmentSource = process.env,
): TelephonyTestCallEnvironment | null {
  const authId = environment.PLIVO_AUTH_ID?.trim() ?? "";
  const authToken = environment.PLIVO_AUTH_TOKEN?.trim() ?? "";
  const destinationResult = configuredPhoneNumberSchema.safeParse(
    environment[PLIVO_TEST_CALL_DESTINATION_ENV],
  );
  if (authId === "" || authToken === "" || !destinationResult.success) {
    return null;
  }

  const destination = destinationResult.data;
  const destinationLast4 = destination.slice(-4);
  return Object.freeze({
    authId,
    authToken,
    destination,
    destinationLast4,
    destinationLabel: `Test number ending in ${destinationLast4}`,
  });
}

/** Allows the UI to show a mask even when credentials are unavailable. */
export function resolveTelephonyTestDestinationLabel(
  environment: TelephonyTestCallEnvironmentSource = process.env,
): string | null {
  const result = configuredPhoneNumberSchema.safeParse(
    environment[PLIVO_TEST_CALL_DESTINATION_ENV],
  );
  return result.success
    ? `Test number ending in ${result.data.slice(-4)}`
    : null;
}
