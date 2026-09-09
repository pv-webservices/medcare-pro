import Link from "next/link";
import { notFound } from "next/navigation";
import PlatformTenantIvr from "@/components/owner/PlatformTenantIvr";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getPlatformTenantIvr } from "@/lib/platform/plivoNumbers";

export default async function OwnerTenantIvrPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  const model = await getPlatformTenantIvr(owner, id);
  if (!model) notFound();
  return (
    <div className="w-full space-y-6 px-4 py-7 text-white sm:px-6 md:px-8 lg:px-10">
      <div>
        <Link href={`/owner/applications/${id}`} className="text-xs font-semibold text-slate-400 hover:text-white">← Back to organisation</Link>
        <h1 className="mt-3 text-2xl font-bold">IVR / Plivo</h1>
        <p className="mt-1 text-sm text-slate-400">Platform-managed phone numbers for {model.tenant.name}.</p>
      </div>
      <PlatformTenantIvr initialModel={model} />
    </div>
  );
}
