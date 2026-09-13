import { patientPortalStaffApi } from "@/lib/patientPortalStaffApi";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await context.params;
  return patientPortalStaffApi(request, id, action);
}
