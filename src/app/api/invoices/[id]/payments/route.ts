import { requireActor } from "@/lib/session";
import { readJsonBody } from "@/lib/apiHandler";
import { billingJsonOk, billingErrorResponse } from "@/lib/billing/billingApi";
import { recordPayment } from "@/lib/billing/payments";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await params;

    return billingJsonOk(await recordPayment(actor, id, await readJsonBody(request)), 201);
  } catch (error) { return billingErrorResponse(error, "POST payment"); }
}
