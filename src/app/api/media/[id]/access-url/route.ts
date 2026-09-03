import { jsonOk, toErrorResponse } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { generateMediaPreviewUrlForActor } from "@/lib/mediaAssets";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, props: RouteProps) {
  try {
    const { id } = await props.params;
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const result = await generateMediaPreviewUrlForActor(actor, id);
    return jsonOk(result);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/media/[id]/access-url");
  }
}
