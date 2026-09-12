import Link from "next/link";
import type { listPrescriptionsForActor } from "@/lib/prescriptions";
type History = Awaited<ReturnType<typeof listPrescriptionsForActor>>;
export default function PrescriptionHistory({ history }: { history: History }) {
  if (!history.rows.length)
    return <p className="py-5 text-muted">No prescriptions in this scope.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-canvas">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-canvas-deep">
          <tr>
            {[
              "Prescription",
              "Patient",
              "Doctor / Clinic",
              "Status",
              "Issued / Updated",
            ].map((label) => (
              <th key={label} className="p-4">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.rows.map((row) => (
            <tr key={row.id} className="border-b border-line">
              <td className="p-4">
                <Link
                  className="break-all text-accent underline"
                  href={
                    row.status === "DRAFT"
                      ? `/registration/${row.registrationId}/consultation`
                      : `/prescriptions/${row.id}`
                  }
                >
                  {row.prescriptionNumber || "Continue draft"}
                </Link>
                <p className="text-muted">Version {row.version}</p>
              </td>
              <td className="p-4">
                {row.patient.name}
                <p className="text-muted">{row.patient.patientCode}</p>
              </td>
              <td className="p-4">
                {row.doctor.name}
                <p className="text-muted">{row.clinic.name}</p>
              </td>
              <td className="p-4">{row.status}</td>
              <td className="p-4">
                {new Date(row.issuedAt || row.updatedAt).toLocaleString(
                  "en-IN",
                  { timeZone: "Asia/Kolkata" },
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
