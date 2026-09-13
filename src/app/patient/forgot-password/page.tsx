import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { portalOrgSchema } from "@/lib/patientPortalSecurity";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const org = portalOrgSchema.safeParse((await searchParams).org);
  return (
    <main className="portal-login">
      <PortalAuthForm
        mode="forgot-password"
        organization={org.success ? org.data : ""}
      />
    </main>
  );
}
