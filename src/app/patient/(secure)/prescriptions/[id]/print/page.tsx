import { patientPortalPage } from "@/lib/patientPortalPages";
import { patientOwnedPrescription } from "@/lib/patientPortalRecords";
import PortalPrescription from "@/components/patientPortal/PortalPrescription";
import { PortalPrint } from "@/components/patientPortal/PortalButtons";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rx = await patientPortalPage((actor) =>
    patientOwnedPrescription(actor, id, "PRESCRIPTION_PRINTED"),
  );
  return (
    <div className="portal-print-page">
      <PortalPrint />
      <PortalPrescription rx={rx} />
    </div>
  );
}
