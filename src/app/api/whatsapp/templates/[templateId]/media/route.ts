import {
  jsonOk,
  readJsonBody,
  toErrorResponse,
  BadRequestError,
} from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import {
  bindTemplateMedia,
  getTemplateMediaForClinic,
  removeTemplateMedia,
} from "@/lib/whatsappTemplateMedia";
import {
  bindTemplateMediaSchema,
  removeTemplateMediaSchema,
} from "@/lib/mediaTypes";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ templateId: string }>;
}

export async function GET(request: Request, props: RouteProps) {
  try {
    const { templateId } = await props.params;
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const url = new URL(request.url);
    const clinicId = url.searchParams.get("clinicId")?.trim();
    if (!clinicId) {
      throw new BadRequestError("clinicId parameter is required.");
    }

    const mediaAsset = await getTemplateMediaForClinic(actor, templateId, clinicId);
    return jsonOk({ mediaAsset });
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/whatsapp/templates/[templateId]/media");
  }
}

export async function PUT(request: Request, props: RouteProps) {
  try {
    const { templateId } = await props.params;
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const body = bindTemplateMediaSchema.parse(await readJsonBody(request));

    const result = await bindTemplateMedia(actor, {
      templateId,
      clinicId: body.clinicId,
      mediaAssetId: body.mediaAssetId,
    });

    return jsonOk(result);
  } catch (error: unknown) {
    return toErrorResponse(error, "PUT /api/whatsapp/templates/[templateId]/media");
  }
}

export async function DELETE(request: Request, props: RouteProps) {
  try {
    const { templateId } = await props.params;
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const url = new URL(request.url);
    let clinicId = url.searchParams.get("clinicId")?.trim();

    if (!clinicId) {
      const body = (await readJsonBody(request).catch(() => ({}))) as {
        clinicId?: string;
      };
      clinicId = body.clinicId?.trim();
    }

    if (!clinicId) {
      throw new BadRequestError("clinicId is required.");
    }

    removeTemplateMediaSchema.parse({ clinicId });

    const result = await removeTemplateMedia(actor, {
      templateId,
      clinicId,
    });

    return jsonOk(result);
  } catch (error: unknown) {
    return toErrorResponse(error, "DELETE /api/whatsapp/templates/[templateId]/media");
  }
}
