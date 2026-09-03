import { jsonOk, toErrorResponse, BadRequestError } from "@/lib/apiHandler";
import { requireActor } from "@/lib/session";
import { MODULE_FEATURES, requireModule } from "@/lib/features";
import { parseMultipartUpload } from "@/lib/mediaUploadParser";
import { listMediaForActor, saveUploadedMediaAsset } from "@/lib/mediaAssets";
import type { StoredMediaType } from "@/lib/mediaTypes";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const parsed = await parseMultipartUpload(request);
    if (!parsed.clinicId) {
      throw new BadRequestError("clinicId is required.");
    }

    const asset = await saveUploadedMediaAsset(actor, {
      clinicId: parsed.clinicId,
      fileName: parsed.fileName,
      declaredMimeType: parsed.declaredMimeType,
      stream: parsed.stream,
    });

    return jsonOk(asset, 201);
  } catch (error: unknown) {
    return toErrorResponse(error, "POST /api/media");
  }
}

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireModule(actor, MODULE_FEATURES.whatsapp);

    const url = new URL(request.url);
    const clinicId = url.searchParams.get("clinicId")?.trim();
    if (!clinicId) {
      throw new BadRequestError("clinicId parameter is required.");
    }

    const mediaTypeParam = url.searchParams.get("mediaType")?.trim();
    let mediaType: StoredMediaType | undefined;
    if (
      mediaTypeParam === "IMAGE" ||
      mediaTypeParam === "VIDEO" ||
      mediaTypeParam === "DOCUMENT"
    ) {
      mediaType = mediaTypeParam;
    }

    const items = await listMediaForActor(actor, clinicId, mediaType);
    return jsonOk(items);
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/media");
  }
}
