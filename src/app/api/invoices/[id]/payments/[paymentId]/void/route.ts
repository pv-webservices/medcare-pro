import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { voidPayment } from "@/lib/billing/payments";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const actor = await requireActor();
    const { id, paymentId } = await params;

    return billingJsonOk(await voidPayment(actor, id, paymentId, await readJsonBody(request)));
  } catch (error) { return billingErrorResponse(error, "POST void payment"); }
}
