import { cookies } from "next/headers";
import { portalApi, portalJson, readJsonBody } from "@/lib/patientPortalApi";
import {
  PatientPortalError,
  PORTAL_COOKIE,
  PORTAL_LOGIN_MESSAGE,
  portalLoginSchema,
  portalVerifySchema,
  portalActivationRequestSchema,
  portalActivationVerifySchema,
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
  requestPatientPortalCode,
  verifyPatientPortalCode,
} from "@/lib/patientPortalOtp";
import {
  patientPortalProfile,
  patientPortalHistory,
  patientOwnedPrescription,
  patientOwnedRegistration,
  patientOwnedAppointment,
} from "@/lib/patientPortalRecords";
import { readClientIp, readUserAgent } from "@/lib/requestMeta";

type Context = { params: Promise<{ path: string[] }> };
export async function POST(request: Request, context: Context) {
  return portalApi(request, async () => {
    const path = (await context.params).path.join("/");
    const body = await readJsonBody(request);
    const ip = readClientIp(request);
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
    if (path === "auth/login/request") {
      const input = portalLoginSchema.parse(body);
      await portalAuthRateLimit(ip, input.mobile);
      await requestPatientPortalCode(input);
      return portalJson({ message: PORTAL_LOGIN_MESSAGE });
    }
    if (path === "auth/activation/request") {
      const input = portalActivationRequestSchema.parse(body);
      await portalAuthRateLimit(ip, hashPortalToken(input.token));
      await requestPatientPortalCode(input);
      return portalJson({
        message: "A verification code has been sent to your verified contact.",
      });
    }
    if (path === "auth/login/verify" || path === "auth/activation/verify") {
      const input =
        path === "auth/login/verify"
          ? portalVerifySchema.parse(body)
          : portalActivationVerifySchema.parse(body);
      await portalAuthRateLimit(
        ip,
        "mobile" in input ? input.mobile : hashPortalToken(input.token),
        true,
      );
      const token = await verifyPatientPortalCode(input, {
        ip,
        userAgent: readUserAgent(request),
      });
      const response = portalJson({ message: "Signed in." });
      response.cookies.set(PORTAL_COOKIE, token, patientCookieOptions());
      return response;
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
