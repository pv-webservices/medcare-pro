import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { loadPortalActivation } from "@/lib/patientPortalActivation";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let available = false;
  try {
    await loadPortalActivation(token);
    available = true;
  } catch (e) {
    if (!(e instanceof PatientPortalError)) throw e;
  }
  return (
    <main className="portal-login">
      {available ? (
        <PortalAuthForm token={token} />
      ) : (
        <section className="portal-auth">
          <h1>Activation unavailable</h1>
          <p>Ask your clinic for a new activation QR.</p>
        </section>
      )}
    </main>
  );
}
