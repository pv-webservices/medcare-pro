import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { dashboardLayoutInputSchema } from "@/lib/dashboardWidgets";
import {
  getEffectiveDashboardLayout,
  resetPersonalDashboardLayout,
  savePersonalDashboardLayout,
} from "@/lib/dashboardLayouts";
import { requireActor } from "@/lib/session";

export async function GET() {
  try {
    const actor = await requireActor();
    return jsonOk(await getEffectiveDashboardLayout(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/dashboard/layout");
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireActor();
    const input = dashboardLayoutInputSchema.parse(await readJsonBody(request));
    return jsonOk(await savePersonalDashboardLayout(actor, input));
  } catch (error: unknown) {
    return toErrorResponse(error, "PUT /api/dashboard/layout");
  }
}

export async function DELETE() {
  try {
    const actor = await requireActor();
    return jsonOk(await resetPersonalDashboardLayout(actor));
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/dashboard/layout");
  }
}
