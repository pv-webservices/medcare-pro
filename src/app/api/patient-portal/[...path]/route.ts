import { cookies } from "next/headers";
import { portalApi, portalJson, readJsonBody } from "@/lib/patientPortalApi";
import {
  PatientPortalError,
  PORTAL_COOKIE,
  PORTAL_RESET_MESSAGE,
  portalLoginSchema,
  portalActivationSchema,
  portalResetRequestSchema,
  portalResetSchema,
  portalEmailChangeSchema,
  portalTokenSchema,
  portalEmptySchema,
  portalPageSchema,
  hashPortalToken,
} from "@/lib/patientPortalSecurity";
import {
  requirePatientActor,
  logoutPatientPortal,
  patientCookieOptions,
} from "@/lib/patientPortalSession";
import {
  portalAuthRateLimit,
  loginPatientPortal,
  activatePatientPortal,
  requestPatientPasswordReset,
  resetPatientPassword,
  verifyPatientRecoveryEmail,
  changePatientRecoveryEmail,
  resendPatientRecoveryEmail,
  patientPortalSecurityProfile,
} from "@/lib/patientPortalPasswordAuth";
import {
  patientPortalProfile,
  patientPortalHistory,
  patientOwnedPrescription,
  patientOwnedRegistration,
  patientOwnedAppointment,
} from "@/lib/patientPortalRecords";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";
import { z } from "zod";
type Context = { params: Promise<{ path: string[] }> };
export async function POST(request: Request, context: Context) {
  return portalApi(request, async () => {
    const path = (await context.params).path.join("/");
    const body = await readJsonBody(request);
    const ip = readClientIp(request);
    const meta = { ip, userAgent: readUserAgent(request) };
    if (path === "auth/logout") {
      portalEmptySchema.parse(body);
      await logoutPatientPortal((await cookies()).get(PORTAL_COOKIE)?.value);
      const response = portalJson({ message: "Signed out." });
      response.cookies.set(PORTAL_COOKIE, "", {
        ...patientCookieOptions(),
        maxAge: 0,
      });
      return response;
    }
    if (path === "auth/login") {
      // Malformed identities use the same public sign-in error.

      const parsed = portalLoginSchema.safeParse(body);
      if (!parsed.success) {
        await portalAuthRateLimit(ip, ip ?? "unknown");
        throw new PatientPortalError(400, "Invalid sign-in details.");
      }
      const input = parsed.data;
      await portalAuthRateLimit(
        ip,
        `${input.organization}:${input.patientCode}`,
      );
      const token = await loginPatientPortal(input, meta);
      const response = portalJson({ message: "Signed in." });
      response.cookies.set(PORTAL_COOKIE, token, patientCookieOptions());
      return response;
    }
    if (path === "auth/activate") {
      const input = portalActivationSchema.parse(body);
      await portalAuthRateLimit(ip, hashPortalToken(input.token), "activation");
      const result = await activatePatientPortal(input, meta);
      const response = portalJson({ message: result.message });
      response.cookies.set(
        PORTAL_COOKIE,
        result.sessionToken,
        patientCookieOptions(),
      );
      return response;
    }
    if (path === "auth/forgot-password") {
      const parsed = portalResetRequestSchema.safeParse(body);
      await portalAuthRateLimit(
        ip,
        parsed.success
          ? `${parsed.data.organization}:${parsed.data.patientCode}`
          : "invalid",
        "reset-request",
        true,
      );
      if (parsed.success) await requestPatientPasswordReset(parsed.data);
      return portalJson({ message: PORTAL_RESET_MESSAGE });
    }
    if (path === "auth/reset-password") {
      const input = portalResetSchema.parse(body);
      await portalAuthRateLimit(ip, hashPortalToken(input.token), "reset");
      await resetPatientPassword(input);
      return portalJson({
        message: "Password updated. Sign in with your new password.",
      });
    }
    if (path === "auth/verify-email") {
      const input = z.strictObject({ token: portalTokenSchema }).parse(body);
      await portalAuthRateLimit(
        ip,
        hashPortalToken(input.token),
        "email-verify",
      );
      await verifyPatientRecoveryEmail(input.token);
      return portalJson({ message: "Recovery email verified." });
    }
    if (path === "me/security/email" || path === "me/security/resend") {
      const actor = await requirePatientActor();
      await portalAuthRateLimit(
        ip,
        actor.portalAccountId,
        "email-request",
        true,
      );
      if (path.endsWith("resend")) {
        portalEmptySchema.parse(body);
        await resendPatientRecoveryEmail(actor);
      } else
        await changePatientRecoveryEmail(
          actor,
          portalEmailChangeSchema.parse(body),
        );
      return portalJson({ message: "Verification email sent." });
    }
    throw new PatientPortalError(404, "Not found.");
  });
}
export async function GET(request: Request, context: Context) {
  return portalApi(request, async () => {
    const parts = (await context.params).path;
    const pagination = portalPageSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const actor = await requirePatientActor();
    if (parts.join("/") === "me/security")
      return portalJson(await patientPortalSecurityProfile(actor));
    if (parts.join("/") === "me")
      return portalJson(await patientPortalProfile(actor));
    const kind = parts[1];
    if (
      parts[0] === "me" &&
      ["visits", "appointments", "prescriptions"].includes(kind)
    ) {
      if (parts.length === 2)
        return portalJson(
          await patientPortalHistory(
            actor,
            kind as "visits" | "appointments" | "prescriptions",
            pagination.page,
          ),
        );
      if (parts.length === 3)
        return portalJson(
          kind === "prescriptions"
            ? await patientOwnedPrescription(actor, parts[2])
            : kind === "visits"
              ? await patientOwnedRegistration(actor, parts[2])
              : await patientOwnedAppointment(actor, parts[2]),
        );
    }
    throw new PatientPortalError(404, "Not found.");
  });
}
