import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getTenantEntitlements } from "@/lib/platform/entitlements";
import { ScopeError } from "@/lib/rbac";
import TenantEntitlementsPanel from "@/components/owner/TenantEntitlementsPanel";

/**
 * One organisation's plan and overrides — Stage 9, layer 2b.
 *
 * A sub-page of the application rather than a second URL space for the same
 * row: an application and an organisation are one Tenant, and giving it two
 * prefixes would mean two places to look for a clinic and two places to keep the
 * reserved-platform-tenant filter.
 *
 * `getTenantEntitlements` throws ScopeError for both an unknown id and the
 * reserved platform row, and it is rendered as 404 here — the same answer as an
 * unknown URL, so neither can be probed for.
 */

interface PageProps {
  // Next 16 hands route params to the page as a promise.
  params: Promise<{ id: string }>;
}

export default async function OwnerTenantEntitlementsPage({ params }: PageProps) {
  const owner = await requireOwnerPage();
  const { id } = await params;

  let view;
  try {
    view = await getTenantEntitlements(owner, id);
  } catch (error: unknown) {
    if (error instanceof ScopeError) {
      notFound();
    }
    throw error;
  }

  const entitled = view.features.filter((feature) => feature.effective).length;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href={`/owner/applications/${view.tenantId}`}
        className="mb-6 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {view.clinicName}
      </Link>

      <h1 className="text-xl font-semibold">{view.clinicName}</h1>
      <p className="mt-1 text-xs text-slate-400">
        {view.planName ? `On the ${view.planName} plan` : "No plan assigned"} ·{" "}
        <span className="tabular-nums">{entitled}</span> of{" "}
        <span className="tabular-nums">{view.features.length}</span> features
        available to them · {view.status.toLowerCase()}
      </p>

      <div className="mt-6">
        <TenantEntitlementsPanel view={view} />
      </div>

      <p className="mt-8 text-[11px] text-slate-500">
        Revoking a feature leaves this organisation&rsquo;s per-role settings
        untouched. They stop mattering while the entitlement is gone and take
        effect again if it is restored, so a revoke followed by a restore does not
        quietly hand the module to every role.
      </p>
    </div>
  );
}
