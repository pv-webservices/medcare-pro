import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { createServiceItem, listServiceItemsForActor } from "@/lib/billing/serviceItems";
import { serviceItemFiltersSchema } from "@/lib/billing/billingValidation";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const filters = serviceItemFiltersSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return billingJsonOk(await listServiceItemsForActor(actor, filters));
  } catch (error) { return billingErrorResponse(error, "GET billing services"); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    return billingJsonOk(await createServiceItem(actor, await readJsonBody(request)), 201);
  } catch (error) { return billingErrorResponse(error, "POST billing services"); }
}
