import { PatientPortalError } from "@/lib/patientPortalSecurity";

export interface PatientPortalVerificationSender {
  sendActivation(input: {
    mobileE164: string;
    activationUrl: string;
  }): Promise<void>;
  sendLoginCode(input: {
    mobileE164: string;
    code: string;
    purpose: "LOGIN" | "ACTIVATION";
  }): Promise<void>;
}
/** Security messages must not enter the clinical WhatsApp message-history table.
 * No production adapter is registered until a safe delivery contract is reviewed.
 * No OTP/token is ever returned by an HTTP endpoint or logged.
 */
export async function patientPortalSender(): Promise<PatientPortalVerificationSender> {
  const provider =
    process.env.PATIENT_PORTAL_DELIVERY_PROVIDER?.trim() ||
    (process.env.PATIENT_PORTAL_TEST_TRANSPORT === "local-file"
      ? "local-file"
      : undefined);

  if (provider === "local-file") {
    const { createPatientPortalTestSender } = await import(
      "@/lib/patientPortalTestSender"
    );
    return createPatientPortalTestSender();
  }

  if (provider === "plivo") {
    const { createPatientPortalPlivoSender } = await import(
      "@/lib/telephony/patientPortalPlivoSender"
    );
    return createPatientPortalPlivoSender();
  }

  throw new PatientPortalError(
    503,
    "Patient Portal verification delivery is unavailable. Please contact your clinic.",
  );
}
