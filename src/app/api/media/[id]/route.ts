import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { deleteMediaForActor, getMediaForActor } from "@/lib/mediaAssets";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, props: RouteProps) {
  try {
    const { id } = await props.params;
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const asset = await getMediaForActor(actor, id);
    return jsonOk(asset);
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/media/[id]");
  }
}

export async function DELETE(_request: Request, props: RouteProps) {
  try {
    const { id } = await props.params;
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const result = await deleteMediaForActor(actor, id);
    return jsonOk(result);
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/media/[id]");
  }
}
