import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { archiveTask } from "@/lib/tasks";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return jsonOk(await archiveTask(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/tasks/[id]/archive");
  }
}

