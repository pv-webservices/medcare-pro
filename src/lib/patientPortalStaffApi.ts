import { portalApi, portalJson, readJsonBody } from "@/lib/patientPortalApi";
import { requireActor } from "@/lib/session";
import {
  portalStaffActivationSchema,
  portalEmptySchema,
  PatientPortalError,
} from "@/lib/patientPortalSecurity";
import {
  createPortalActivation,
  getStaffPortalStatus,
  revokePatientPortal,
} from "@/lib/patientPortalActivation";
export function patientPortalStaffApi(
  request: Request,
  id: string,
  action?: string,
) {
  return portalApi(request, async () => {
    const actor = await requireActor();
    if (request.method === "GET" && !action)
      return portalJson(await getStaffPortalStatus(actor, id));
    const body = await readJsonBody(request);
    if (action === "activate" || action === "resend") {
      portalStaffActivationSchema.parse(body);
      return portalJson(
        await createPortalActivation(actor, id, action === "resend"),
      );
    }
    if (action === "revoke") {
      portalEmptySchema.parse(body);
      return portalJson(await revokePatientPortal(actor, id));
    }
    throw new PatientPortalError(404, "Not found.");
  });
}
