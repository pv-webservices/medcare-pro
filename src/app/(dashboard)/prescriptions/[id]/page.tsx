import Link from "next/link";
import PrescriptionDocument from "@/components/prescriptions/PrescriptionDocument";
import PrescriptionActions from "@/components/prescriptions/PrescriptionActions";
import { getPrescriptionForActor } from "@/lib/prescriptions";
import { prescriptionPage } from "@/lib/prescriptionPages";
import { mayViewClinicalAudio } from "@/lib/clinical-audio/authorization";
export const dynamic = "force-dynamic";
export default async function PrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, transcripts } = await prescriptionPage(async (actor) => {
    const data = await getPrescriptionForActor(actor, id);
    return {
      data,
      transcripts:
        !!data.snapshot && (await mayViewClinicalAudio(actor, data.registrationId)),
    };
  });
  return (
    <section className="space-y-5">
      <Link
        className="text-accent underline"
        href={`/registration/${data.registrationId}`}
      >
        Back to patient visit
      </Link>
      <h1 className="break-all text-2xl font-bold">
        {data.prescriptionNumber || "Draft prescription"}
      </h1>
      <p>
        {data.status} · Version {data.version}
      </p>
      {data.supersedes && (
        <p>
          Corrected version of{" "}
          <Link
            className="text-accent underline"
            href={`/prescriptions/${data.supersedes.id}`}
          >
            {data.supersedes.prescriptionNumber}
          </Link>
        </p>
      )}
      {data.supersededBy && (
        <p>
          {data.supersededBy.status === "DRAFT"
            ? "Correction draft pending"
            : "Superseded by"}
          :{" "}
          <Link
            className="text-accent underline"
            href={`/prescriptions/${data.supersededBy.id}`}
          >
            {data.supersededBy.prescriptionNumber || "Draft"}
          </Link>
        </p>
      )}
      {data.cancellationReason && (
        <p className="rounded-xl border border-line p-4">
          Cancelled{" "}
          {data.cancelledAt &&
            new Date(data.cancelledAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })}
          : {data.cancellationReason}
        </p>
      )}
      {data.snapshot ? (
        <>
          <PrescriptionActions
            id={id}
            mayCorrect={data.mayCorrect}
            mayCancel={data.mayCancel}
          />
          {transcripts && (
            <Link
              className="text-accent underline"
              href={`/registration/${data.registrationId}/consultation`}
            >
              Recording &amp; transcript
            </Link>
          )}
          <PrescriptionDocument
            snapshot={data.snapshot}
            status={data.status}
            version={data.version}
          />
        </>
      ) : (
        <Link
          className="text-accent underline"
          href={`/registration/${data.registrationId}/consultation`}
        >
          Continue consultation draft
        </Link>
      )}
    </section>
  );
}
