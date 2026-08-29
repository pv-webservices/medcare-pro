import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import {
  createTask,
  createTaskSchema,
  listTasks,
  taskFilterSchema,
} from "@/lib/tasks";
import { requireActor } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const filters = taskFilterSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return jsonOk(await listTasks(actor, filters));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/tasks");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = createTaskSchema.parse(await readJsonBody(request));
    return jsonOk(await createTask(actor, input), 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/tasks");
  }
}

