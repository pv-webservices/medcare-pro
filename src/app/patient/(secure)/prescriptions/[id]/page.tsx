import Link from "next/link";
import { patientPortalPage } from "@/lib/patientPortalPages";
import { patientOwnedPrescription } from "@/lib/patientPortalRecords";
import PortalPrescription from "@/components/patientPortal/PortalPrescription";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rx = await patientPortalPage((actor) =>
    patientOwnedPrescription(actor, id),
  );
  return (
    <>
      <div className="portal-actions">
        <Link href="/patient/prescriptions">← My Prescriptions</Link>
        <Link href={`/patient/prescriptions/${id}/print`}>
          Print / Save as PDF
        </Link>
        {rx.latestId && (
          <Link href={`/patient/prescriptions/${rx.latestId}`}>
            View newer prescription
          </Link>
        )}
      </div>
      <PortalPrescription rx={rx} />
    </>
  );
}
