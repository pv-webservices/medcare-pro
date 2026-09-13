import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { loadPortalActivation } from "@/lib/patientPortalActivation";
import { PatientPortalError } from "@/lib/patientPortalSecurity";
import { prisma } from "@/lib/prisma";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let available = false;
  let organization = "";
  let clinicName: string | null = null;
  try {
    const activation = await loadPortalActivation(token);
    available = true;
    const tenant = await prisma.tenant.findUnique({
      where: { id: activation.tenantId },
      select: { slug: true, businessName: true },
    });
    if (tenant) {
      organization = tenant.slug;
      clinicName = tenant.businessName;
    }
  } catch (e) {
    if (!(e instanceof PatientPortalError)) throw e;
  }
  return (
    <main className="portal-login">
      {available ? (
        <PortalAuthForm
          token={token}
          organization={organization}
          clinicName={clinicName}
        />
      ) : (
        <section className="portal-auth">
          <h1>Activation unavailable</h1>
          <p>Ask your clinic for a new activation QR.</p>
        </section>
      )}
    </main>
  );
}
