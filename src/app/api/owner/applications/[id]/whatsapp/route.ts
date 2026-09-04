import { jsonOk, readJsonBody, toErrorResponse } from "@/lib/apiHandler";
import { requirePlatformOwner } from "@/lib/platform/auth";
import {
  listPlatformWhatsappAccounts,
  platformWhatsappAccountSchema,
  savePlatformWhatsappAccount,
} from "@/lib/platform/whatsappProvider";

interface Context { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    return jsonOk(await listPlatformWhatsappAccounts(owner, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "GET /api/owner/applications/[id]/whatsapp");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const owner = await requirePlatformOwner();
    const { id } = await context.params;
    const input = platformWhatsappAccountSchema.parse(await readJsonBody(request));
    await savePlatformWhatsappAccount(owner, id, input);
    return jsonOk(await listPlatformWhatsappAccounts(owner, id));
  } catch (error: unknown) {
    return toErrorResponse(error, "PUT /api/owner/applications/[id]/whatsapp");
  }
}
