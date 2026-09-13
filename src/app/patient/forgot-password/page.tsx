import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
import { portalOrgSchema } from "@/lib/patientPortalSecurity";
import { prisma } from "@/lib/prisma";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const org = portalOrgSchema.safeParse((await searchParams).org);
  let clinicName: string | null = null;
  if (org.success) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: org.data },
      select: { businessName: true },
    });
    clinicName = tenant?.businessName ?? null;
  }
  return (
    <main className="portal-login">
      <PortalAuthForm
        mode="forgot-password"
        organization={org.success ? org.data : ""}
        clinicName={clinicName}
      />
    </main>
  );
}
