import { requireActor } from "@/lib/session";
import { readOptionalJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { emptyInvoiceBodySchema } from "@/lib/billing/invoiceValidation";
import { createReplacementInvoice } from "@/lib/billing/invoices";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    emptyInvoiceBodySchema.parse(await readOptionalJsonBody(request));
    return billingJsonOk(await createReplacementInvoice(actor, id), 201);
  } catch (error) { return billingErrorResponse(error, "POST replace"); }
}
