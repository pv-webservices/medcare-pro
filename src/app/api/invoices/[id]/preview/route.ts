import { requireActor } from "@/lib/session";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { getInvoicePreviewForActor } from "@/lib/billing/invoiceDetail";

/** Read-only review of a saved draft before it is issued (invoice:read scope, DRAFT only). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    return billingJsonOk(await getInvoicePreviewForActor(actor, id));
  } catch (error) { return billingErrorResponse(error, "GET invoice preview"); }
}
