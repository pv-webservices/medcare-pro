import PortalSecurityForm from "@/components/patientPortal/PortalSecurityForm";
import { patientPortalPage } from "@/lib/patientPortalPages";
import { patientPortalProfile } from "@/lib/patientPortalRecords";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ activation?: string }>;
}) {
  const activation = (await searchParams).activation;
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
      <PortalSecurityForm
        activationMessage={
          activation === "email-failed"
            ? "Portal activated, but we couldn't send the recovery-email verification. You can resend it from Profile."
            : activation === "complete"
              ? "Portal activated."
              : undefined
        }
      />
    </>
  );
}
