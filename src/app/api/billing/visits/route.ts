import { requireActor } from "@/lib/session";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { findVisitsToBill } from "@/lib/billing/newBill";

/** "+ New bill" picker: recent visits the actor may bill, by patient name, mobile or code. */
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams.get("search") ?? "";
    return billingJsonOk(await findVisitsToBill(await requireActor(), search));
  } catch (error) { return billingErrorResponse(error, "GET billing visits"); }
}
