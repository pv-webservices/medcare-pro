import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { getInvoiceForActor, saveDraftInvoice } from "@/lib/billing/invoices";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    return billingJsonOk(await getInvoiceForActor(actor, id));
  } catch (error) { return billingErrorResponse(error, "GET invoice"); }
}
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    return billingJsonOk(await saveDraftInvoice(actor, id, await readJsonBody(request)));
  } catch (error) { return billingErrorResponse(error, "PUT invoice"); }
}
