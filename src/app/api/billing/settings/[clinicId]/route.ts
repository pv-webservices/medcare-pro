import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { getBillingSettingsForClinic, saveBillingSettings } from "@/lib/billing/billingSettings";

type Context = { params: Promise<{ clinicId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { clinicId } = await context.params;
    return billingJsonOk(await getBillingSettingsForClinic(actor, clinicId));
  } catch (error) { return billingErrorResponse(error, "GET billing settings"); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { clinicId } = await context.params;
    return billingJsonOk(await saveBillingSettings(actor, clinicId, await readJsonBody(request)));
  } catch (error) { return billingErrorResponse(error, "PUT billing settings"); }
}
