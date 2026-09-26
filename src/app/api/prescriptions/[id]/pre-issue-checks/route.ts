import { z } from "zod";
import {
  prescriptionErrorResponse,
  prescriptionJsonOk,
} from "@/lib/prescriptionApi";
import { requireActor } from "@/lib/session";
import { getPreIssueChecks } from "@/lib/prescriptions";

export const dynamic = "force-dynamic";

const querySchema = z.strictObject({
  expectedRevision: z.coerce.number().int().nonnegative(),
});

/** AI-5 pre-issue checks of a saved draft revision. Read-only. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const { expectedRevision } = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return prescriptionJsonOk(
      await getPreIssueChecks(actor, id, expectedRevision),
    );
  } catch (error) {
    return prescriptionErrorResponse(error, "GET prescription pre-issue checks");
  }
}
