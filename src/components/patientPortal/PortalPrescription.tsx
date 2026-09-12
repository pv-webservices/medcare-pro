import type { patientPrescriptionDto } from "@/lib/patientPortalRecords";
export default function PortalPrescription({
  rx,
}: {
  rx: ReturnType<typeof patientPrescriptionDto>;
}) {
  return (
    <article className="portal-rx">
      <header>
        <p className="portal-eyebrow">PRESCRIPTION · {rx.status}</p>
        <h1>{rx.prescriptionNumber}</h1>
        <p>
          Issued:{" "}
          {new Date(rx.issuedAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
          })}
        </p>
      </header>
      {rx.status === "SUPERSEDED" && (
        <p className="portal-warning">
          This prescription has been replaced by a newer version.
        </p>
      )}
      {rx.status === "CANCELLED" && (
        <p className="portal-warning">
          This prescription is no longer valid. Retained as a historical record.
        </p>
      )}
      <div className="portal-rx-identities">
        <section>
          <h2>{rx.clinic.name}</h2>
          <p>{rx.clinic.address}</p>
          <p>{rx.clinic.city}</p>
          <p>{rx.clinic.phone}</p>
        </section>
        <section>
          <h2>{rx.doctor.name}</h2>
          <p>
            {rx.doctor.qualification} · {rx.doctor.department}
          </p>
          <p>Registration: {rx.doctor.medicalRegistrationNumber}</p>
          <p>{rx.doctor.registrationCouncil}</p>
        </section>
      </div>
      <section className="portal-rx-patient">
        <h2>{rx.patient.name}</h2>
        <p>
          {rx.patient.patientCode} · {rx.patient.age ?? "Age not recorded"} ·{" "}
          {rx.patient.gender}
        </p>
        <p>{rx.patient.mobileNumber}</p>
        <p>
          {[rx.patient.address, rx.patient.city].filter(Boolean).join(", ")}
        </p>
        <p>
          Visit: {rx.visit.visitDate.slice(0, 10)} · {rx.visit.department}
        </p>
      </section>
      {rx.diagnosis && (
        <section>
          <h2>Diagnosis / provisional diagnosis</h2>
          <p>{rx.diagnosis}</p>
        </section>
      )}
      {rx.investigations && (
        <section>
          <h2>Investigations advised</h2>
          <p>{rx.investigations}</p>
        </section>
      )}
      <section>
        <h2>Rx · Medications</h2>
        <ol className="portal-medications">
          {rx.medications.map((m, i) => (
            <li key={i}>
              <h3>
                {i + 1}. {m.medicineGenericName}{" "}
                {m.brandName && `(${m.brandName})`}
              </h3>
              <p>
                {m.dosageForm} · {m.strength}
              </p>
              <p>
                {m.dose} · {m.route} · {m.frequency}
              </p>
              <p>
                {m.timing} · {m.durationValue} {m.durationUnit}
                {m.quantity !== null && ` · Quantity ${m.quantity}`}
              </p>
              <p>{m.instructions}</p>
            </li>
          ))}
        </ol>
      </section>
      {rx.advice && (
        <section>
          <h2>General advice</h2>
          <p>{rx.advice}</p>
        </section>
      )}
      {rx.followUp && (
        <section>
          <h2>Follow-up</h2>
          <p>{rx.followUp}</p>
        </section>
      )}
    </article>
  );
}
