import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { dashboardLayoutInputSchema } from "@/lib/dashboardWidgets";
import {
  getRoleDashboardLayout,
  resetRoleDashboardLayout,
  saveRoleDashboardLayout,
} from "@/lib/dashboardLayouts";
import { requireActor } from "@/lib/session";

interface Context {
  params: Promise<{ roleId: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { roleId } = await context.params;
    return jsonOk(await getRoleDashboardLayout(actor, roleId));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/dashboard/layout/roles/[roleId]");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { roleId } = await context.params;
    const input = dashboardLayoutInputSchema.parse(await readJsonBody(request));
    return jsonOk(await saveRoleDashboardLayout(actor, roleId, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PUT /api/dashboard/layout/roles/[roleId]");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const actor = await requireActor();
    const { roleId } = await context.params;
    return jsonOk(await resetRoleDashboardLayout(actor, roleId));
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/dashboard/layout/roles/[roleId]");
  }
}
