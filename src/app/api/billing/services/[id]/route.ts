import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { updateServiceItem } from "@/lib/billing/serviceItems";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return billingJsonOk(await updateServiceItem(actor, id, await readJsonBody(request)));
  } catch (error) { return billingErrorResponse(error, "PATCH billing service"); }
}
