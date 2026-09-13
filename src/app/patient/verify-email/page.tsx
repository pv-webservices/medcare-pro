import PortalAuthForm from "@/components/patientPortal/PortalAuthForm";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return (
    <main className="portal-login">
      <PortalAuthForm
        mode="verify-email"
        token={(await searchParams).token ?? ""}
      />
    </main>
  );
}
