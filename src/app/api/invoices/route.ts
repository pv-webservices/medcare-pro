import { requireActor } from "@/lib/session";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { listInvoicesForActor } from "@/lib/billing/invoices";

export async function GET(request: Request) {
  try {
    return billingJsonOk(await listInvoicesForActor(await requireActor(), Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) { return billingErrorResponse(error, "GET invoices"); }
}
