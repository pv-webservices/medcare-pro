import Image from "next/image";
import {
  CLINICAL_FIELDS,
  type PrescriptionSnapshot,
} from "@/lib/prescriptionValidation";

export default function PrescriptionDocument({
  snapshot,
  draft = false,
  status = "ISSUED",
  version = 1,
}: {
  snapshot: PrescriptionSnapshot;
  draft?: boolean;
  status?: string;
  version?: number;
}) {
  const { patient, doctor, clinic, visit, consultation, medications } =
    snapshot;
  return (
    <article className="rx-document space-y-5 bg-white p-6 text-black sm:p-10">
      {draft && (
        <p className="border-2 border-black p-3 text-center font-bold">
          DRAFT — NOT VALID AS ISSUED PRESCRIPTION
        </p>
      )}
      {!draft && status !== "ISSUED" && (
        <p className="border-2 border-black p-3 text-center font-bold">
          {status} — retained historical record
        </p>
      )}
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-5">
        <div>
          {/* Existing clinic branding supports uploaded URLs and data images. */}
          {clinic.logoUrl && (
            <Image
              unoptimized
              loading="eager"
              width={192}
              height={64}
              src={clinic.logoUrl}
              alt={`${clinic.name} logo`}
              className="mb-3 h-16 max-w-48 object-contain"
            />
          )}
          <h1 className="text-2xl font-bold">{clinic.name}</h1>
          <p className="whitespace-pre-wrap">{clinic.address}</p>
          <p>{clinic.city}</p>
          {clinic.phone && <p>Contact: {clinic.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">{doctor.name}</p>
          <p>{doctor.qualification}</p>
          <p>{doctor.department}</p>
          <p>Registration: {doctor.medicalRegistrationNumber}</p>
          <p>{doctor.registrationCouncil}</p>
          {doctor.phone && <p>Contact: {doctor.phone}</p>}
        </div>
      </header>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <p className="break-all">
          Prescription:{" "}
          {draft ? "Awaiting issuance" : snapshot.prescriptionNumber} · Version{" "}
          {version}
        </p>
        <p>
          {draft ? "Review" : "Issued"}:{" "}
          {new Date(snapshot.issuedAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
          })}
        </p>
      </div>
      <section className="grid gap-2 border-y border-black py-4 sm:grid-cols-2">
        <p>
          <strong>Patient:</strong> {patient.name}
        </p>
        <p>
          <strong>Patient ID:</strong> {patient.patientCode}
        </p>
        <p>
          <strong>Age / gender:</strong> {patient.age ?? "Not recorded"} /{" "}
          {patient.gender || "Not recorded"}
        </p>
        <p>
          <strong>Mobile:</strong> {patient.mobileNumber}
        </p>
        <p className="whitespace-pre-wrap sm:col-span-2">
          <strong>Address:</strong>{" "}
          {[patient.address, patient.city].filter(Boolean).join(", ") ||
            "Not recorded"}
        </p>
        <p>
          <strong>Visit:</strong> {visit.visitDate.slice(0, 10)}{" "}
          {visit.visitDate.slice(11, 16)}
        </p>
        <p>
          <strong>Department:</strong> {visit.department} · {visit.visitType}
        </p>
        <p className="break-all text-xs sm:col-span-2">
          Visit ID: {visit.registrationId} · Consultation mode:{" "}
          {consultation.consultationMode.replaceAll("_", " ")}
        </p>
      </section>
      {CLINICAL_FIELDS.slice(0, 5).map(
        ([key, label]) =>
          consultation[key] && (
            <section key={key}>
              <h2 className="font-semibold">{label}</h2>
              <p className="whitespace-pre-wrap break-words">
                {consultation[key]}
              </p>
            </section>
          ),
      )}
      <section>
        <h2 className="mb-3 text-3xl font-semibold">Rx</h2>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="p-2"># / Medicine</th>
              <th className="p-2">Dose / Route</th>
              <th className="p-2">Frequency / Timing</th>
              <th className="p-2">Duration / Quantity</th>
            </tr>
          </thead>
          <tbody>
            {medications.map((item, i) => (
              <tr key={i} className="border-b border-black align-top">
                <td className="p-2">
                  <strong>
                    {i + 1}. {item.medicineGenericName}
                  </strong>
                  {item.brandName && <p>{item.brandName}</p>}
                  <p>
                    {item.strength} {item.dosageForm}
                  </p>
                  {item.instructions && (
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      Instructions: {item.instructions}
                    </p>
                  )}
                </td>
                <td className="p-2">
                  <p>{item.dose}</p>
                  <p>{item.route}</p>
                </td>
                <td className="p-2">
                  <p>{item.frequency}</p>
                  <p>{item.timing}</p>
                </td>
                <td className="p-2">
                  <p>
                    {item.durationValue} {item.durationUnit}
                  </p>
                  {item.quantity !== null && <p>Quantity: {item.quantity}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {CLINICAL_FIELDS.slice(5).map(
        ([key, label]) =>
          consultation[key] && (
            <section key={key}>
              <h2 className="font-semibold">{label}</h2>
              <p className="whitespace-pre-wrap break-words">
                {consultation[key]}
              </p>
            </section>
          ),
      )}
      <footer className="rx-signature mt-10 border-t border-black pt-8 text-right">
        <p className="font-semibold">{doctor.name}</p>
        <p>{doctor.qualification}</p>
        <p>
          {doctor.medicalRegistrationNumber} · {doctor.registrationCouncil}
        </p>
        <p className="mt-6 text-xs">Doctor identification / signature</p>
      </footer>
    </article>
  );
}
