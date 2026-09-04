import Link from "next/link";
import { notFound } from "next/navigation";
import PlatformWhatsappAccounts from "@/components/owner/PlatformWhatsappAccounts";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getClinicApplication } from "@/lib/platform/applications";
import { listPlatformWhatsappAccounts } from "@/lib/platform/whatsappProvider";

export default async function OwnerWhatsappPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  const application = await getClinicApplication(owner, id);
  if (!application) notFound();
  const accounts = await listPlatformWhatsappAccounts(owner, id);
  return (
    <div className="w-full space-y-6 px-4 py-7 text-white sm:px-6 md:px-8 lg:px-10">
      <div>
        <Link href={`/owner/applications/${id}`} className="text-xs font-semibold text-slate-400 hover:text-white">← Back to organisation</Link>
        <h1 className="mt-3 text-2xl font-bold">RkvRobo WhatsApp</h1>
        <p className="mt-1 text-sm text-slate-400">Platform-managed provider credentials for {application.clinicName}.</p>
      </div>
      <PlatformWhatsappAccounts tenantId={id} initialAccounts={accounts} />
    </div>
  );
}
