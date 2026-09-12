import { patientPortalStaffApi } from "@/lib/patientPortalStaffApi";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return patientPortalStaffApi(request, (await context.params).id);
}
