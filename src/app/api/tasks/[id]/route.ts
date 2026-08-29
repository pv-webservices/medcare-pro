import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { getTask, updateTask, updateTaskSchema } from "@/lib/tasks";
import { requireActor } from "@/lib/session";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return jsonOk(await getTask(actor, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/tasks/[id]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const input = updateTaskSchema.parse(await readJsonBody(request));
    return jsonOk(await updateTask(actor, id, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PATCH /api/tasks/[id]");
  }
}

