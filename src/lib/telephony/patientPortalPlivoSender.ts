import { Client } from "plivo";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
import type { PatientPortalVerificationSender } from "@/lib/patientPortalSender";

export interface PlivoMessagesClient {
  messages: {
    create(
      src: string,
      dst: string,
      text: string,
      optionalParams?: { log?: boolean | string },
    ): Promise<{ messageUuid?: string[]; message?: string }>;
  };
}

export interface PlivoSenderOptions {
  authId?: string;
  authToken?: string;
  senderId?: string;
  client?: PlivoMessagesClient;
}

function maskMobile(mobile: string): string {
  if (mobile.length <= 6) return "***";
  const start = mobile.slice(0, 3);
  const end = mobile.slice(-3);
  return `${start}****${end}`;
}

/**
 * Plivo SMS verification delivery adapter for Patient Portal.
 * Never logs raw OTPs, activation URLs, or patient health information.
 * Uses Plivo SDK's log: false option so message text is not logged on provider infrastructure.
 */
export function createPatientPortalPlivoSender(
  options: PlivoSenderOptions = {},
): PatientPortalVerificationSender {
  const authId = options.authId ?? process.env.PLIVO_AUTH_ID?.trim();
  const authToken = options.authToken ?? process.env.PLIVO_AUTH_TOKEN?.trim();
  const senderId =
    options.senderId !== undefined
      ? options.senderId.trim()
      : (process.env.PATIENT_PORTAL_SMS_SENDER?.trim() ||
         process.env.PLIVO_SMS_SENDER?.trim() ||
         "MEDCARE");

  if (!authId || !authToken) {
    throw new PatientPortalError(
      503,
      "Patient Portal SMS verification delivery is misconfigured (missing credentials).",
    );
  }

  if (!senderId) {
    throw new PatientPortalError(
      503,
      "Patient Portal SMS verification delivery is misconfigured (missing sender number).",
    );
  }

  const client: PlivoMessagesClient =
    options.client ?? (new Client(authId, authToken) as unknown as PlivoMessagesClient);

  return {
    async sendActivation(input: {
      mobileE164: string;
      activationUrl: string;
    }): Promise<void> {
      const text = `Your MEDCARE PRO portal activation link: ${input.activationUrl}\nThis link expires in 24 hours. Do not share this link.`;
      try {
        const res = await client.messages.create(
          senderId,
          input.mobileE164,
          text,
          { log: false },
        );
        console.info(
          `[PatientPortal] Activation SMS dispatched via Plivo for ${maskMobile(input.mobileE164)}, request ID: ${res.messageUuid?.[0] ?? "unknown"}`,
        );
      } catch (error: unknown) {
        console.error(
          `[PatientPortal] Plivo activation delivery failure:`,
          error instanceof Error ? error.message : "Unknown error",
        );
        throw new PatientPortalError(
          503,
          "Failed to deliver portal activation message.",
        );
      }
    },

    async sendLoginCode(input: {
      mobileE164: string;
      code: string;
      purpose: "LOGIN" | "ACTIVATION";
    }): Promise<void> {
      const text = `Your MEDCARE PRO verification code is ${input.code}. It expires in 10 minutes. Do not share this code.`;
      try {
        const res = await client.messages.create(
          senderId,
          input.mobileE164,
          text,
          { log: false },
        );
        console.info(
          `[PatientPortal] Verification code SMS dispatched via Plivo (${input.purpose}) for ${maskMobile(input.mobileE164)}, request ID: ${res.messageUuid?.[0] ?? "unknown"}`,
        );
      } catch (error: unknown) {
        console.error(
          `[PatientPortal] Plivo verification code delivery failure:`,
          error instanceof Error ? error.message : "Unknown error",
        );
        throw new PatientPortalError(
          503,
          "Failed to deliver verification code.",
        );
      }
    },
  };
}
