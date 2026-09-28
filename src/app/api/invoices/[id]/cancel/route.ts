import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { cancelInvoice } from "@/lib/billing/invoices";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    return billingJsonOk(await cancelInvoice(actor, id, await readJsonBody(request)));
  } catch (error) { return billingErrorResponse(error, "POST cancel"); }
}
