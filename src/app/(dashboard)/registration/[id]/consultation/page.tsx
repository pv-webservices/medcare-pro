import ConsultationWorkspace from "@/components/prescriptions/ConsultationWorkspace";
import { getConsultationForRegistration } from "@/lib/prescriptions";
import { prescriptionPage } from "@/lib/prescriptionPages";
export const dynamic = "force-dynamic";
export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await prescriptionPage((actor) =>
    getConsultationForRegistration(actor, id),
  );
  return (
    <ConsultationWorkspace key={data.prescription?.id ?? id} data={data} />
  );
}
