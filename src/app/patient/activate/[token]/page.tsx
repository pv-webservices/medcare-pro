import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { loadPortalActivation } from "@/lib/patientPortalActivation";
import {
  PatientPortalError,
  maskPatientMobile,
} from "@/lib/patientPortalSecurity";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let mobile: string | null = null;
  try {
    mobile = (await loadPortalActivation(token)).mobileE164;
  } catch (e) {
    if (!(e instanceof PatientPortalError)) throw e;
  }
  return (
    <main className="portal-login">
      {mobile ? (
        <PortalAuthForm
          token={token}
          maskedMobile={maskPatientMobile(mobile)}
        />
      ) : (
        <section className="portal-auth">
          <h1>Activation unavailable</h1>
          <p>Ask your clinic for a new activation link.</p>
        </section>
      )}
    </main>
  );
}
