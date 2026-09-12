import { patientPortalPage } from "@/lib/patientPortalPages";
import { patientPortalProfile } from "@/lib/patientPortalRecords";
export default async function Page() {
  const p = await patientPortalPage(patientPortalProfile);
  return (
    <>
      <p className="portal-eyebrow">PERSONAL INFORMATION</p>
      <h1>My Profile</h1>
      <p className="portal-muted">
        For corrections, please contact your clinic.
      </p>
      <dl className="portal-profile">
        {[
          ["Patient code", p.patientCode],
          ["Name", p.name],
          ["Age", p.age],
          ["Gender", p.gender],
          ["Mobile", p.mobileNumber],
          ["City", p.city],
          ["Address", p.address],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? "Not recorded"}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
