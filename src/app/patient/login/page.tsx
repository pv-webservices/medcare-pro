import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { portalOrgSchema } from "@/lib/patientPortalSecurity";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; reset?: string }>;
}) {
  const query = await searchParams;
  const org = portalOrgSchema.safeParse(query.org);
  return (
    <main className="portal-login">
      <div>
        {query.reset === "complete" && (
          <p role="status">Password updated. Sign in with your new password.</p>
        )}
        <PortalAuthForm organization={org.success ? org.data : ""} />
      </div>
    </main>
  );
}
