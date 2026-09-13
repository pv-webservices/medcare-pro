import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { resolveSecurityTokenTenant } from "@/lib/patientPortalPasswordAuth";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  const tenant = token
    ? await resolveSecurityTokenTenant(token, "PASSWORD_RESET")
    : null;
  return (
    <main className="portal-login">
      <PortalAuthForm
        mode="reset-password"
        token={token}
        organization={tenant?.slug ?? ""}
        clinicName={tenant?.businessName ?? null}
      />
    </main>
  );
}
