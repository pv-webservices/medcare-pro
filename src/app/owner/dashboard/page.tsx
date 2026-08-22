import Link from "next/link";
import { ShieldCheck, ArrowRight, Layers, ToggleLeft } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getPlatformOverview } from "@/lib/platform/overview";

/**
 * Platform Owner dashboard — Stage 2, extended in Stage 3.
 *
 * The gate is server-side and is the only thing standing between a signed-in
 * clinic user and this page. There is no client-side check to complement it,
 * deliberately: hiding a link is not access control.
 */
export default async function OwnerDashboardPage() {
  const owner = await requireOwnerPage();
  const overview = await getPlatformOverview(owner);

  const cards = [
    { label: "Awaiting approval", value: overview.tenants.PENDING, status: "PENDING" },
    { label: "Active", value: overview.tenants.ACTIVE, status: "ACTIVE" },
    { label: "Suspended", value: overview.tenants.SUSPENDED, status: "SUSPENDED" },
    { label: "Rejected", value: overview.tenants.REJECTED, status: "REJECTED" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-200">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold leading-none">Platform overview</h1>
          <p className="mt-1 text-xs text-slate-400">
            {overview.totalCustomerTenants} clinic organisation
            {overview.totalCustomerTenants === 1 ? "" : "s"} on the platform
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={`/owner/applications?status=${card.status}`}
            className="rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-600"
          >
            <div className="text-2xl font-semibold tabular-nums">{card.value}</div>
            <div className="mt-1 text-xs text-slate-400">{card.label}</div>
          </Link>
        ))}
      </div>

      <Link
        href="/owner/applications?status=PENDING"
        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white"
      >
        Review clinic applications
        <ArrowRight className="h-4 w-4" />
      </Link>

      {/*
        Stage 9. The two entitlement layers that belong to the platform rather
        than to any one organisation. Layer 2b — a single organisation's
        overrides — is deliberately NOT here: it hangs off that organisation's
        own page, because reaching it should require having looked at the clinic
        you are about to change.
      */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link
          href="/owner/features"
          className="rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-600"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <ToggleLeft className="h-4 w-4" />
            Platform features
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Switch a feature off for every organisation at once. Layer 1.
          </p>
        </Link>

        <Link
          href="/owner/plans"
          className="rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-600"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Layers className="h-4 w-4" />
            Plans
          </div>
          <p className="mt-1 text-xs text-slate-400">
            What each plan includes, and who follows it. Layer 2.
          </p>
        </Link>
      </div>
    </div>
  );
}
