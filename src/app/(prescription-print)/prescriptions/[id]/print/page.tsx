import { notFound } from "next/navigation";
import Link from "next/link";
import PrescriptionDocument from "@/components/prescriptions/PrescriptionDocument";
import PrintButton from "@/components/prescriptions/PrintButton";
import { getPrescriptionForActor } from "@/lib/prescriptions";
import { prescriptionPage } from "@/lib/prescriptionPages";
import "./print.css";
export const dynamic = "force-dynamic";
export default async function PrescriptionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await prescriptionPage((actor) =>
    getPrescriptionForActor(actor, id),
  );
  if (!data.snapshot || data.status === "DRAFT") notFound();
  return (
    <main className="rx-print-shell">
      <div className="rx-print-controls">
        <Link href={`/prescriptions/${id}`}>← Prescription</Link>
        <PrintButton />
      </div>
      {data.supersedes && (
        <p className="rx-version-note">
          Corrected version of {data.supersedes.prescriptionNumber}
        </p>
      )}
      {data.supersededBy?.prescriptionNumber && (
        <p className="rx-version-note">
          Superseded by {data.supersededBy.prescriptionNumber}
        </p>
      )}
      <PrescriptionDocument
        snapshot={data.snapshot}
        status={data.status}
        version={data.version}
      />
    </main>
  );
}
