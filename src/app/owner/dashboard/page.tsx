import { notFound, redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requirePlatformOwner } from "@/lib/platform/auth";
import { getPlatformOverview } from "@/lib/platform/overview";
import { PlatformAuthorizationError } from "@/lib/platform/context";

/**
 * Platform Owner dashboard — Stage 2.
 *
 * The gate is here, server-side, and it is the only thing standing between a
 * signed-in clinic user and this page. There is no client-side check to
 * complement it, deliberately: hiding a link is not access control.
 *
 * A signed-in non-Owner gets 404, not 403. 403 would confirm that the platform
 * surface exists and that they simply lack the role — an answer worth nothing
 * to a legitimate user and worth a great deal to someone probing. Only the
 * "no session at all" case redirects to the login screen, and that leaks
 * nothing: /owner/login renders for anyone who asks for it.
 *
 * Read-only. The approval queue lands in Stage 3.
 */
export default async function OwnerDashboardPage() {
  let owner;
  try {
    owner = await requirePlatformOwner();
  } catch (error: unknown) {
    if (error instanceof PlatformAuthorizationError) {
      if (error.reason === "no-session") {
        redirect("/owner/login");
      }
      notFound();
    }
    throw error;
  }

  const overview = await getPlatformOverview(owner);

  const cards = [
    { label: "Awaiting approval", value: overview.tenants.PENDING },
    { label: "Active", value: overview.tenants.ACTIVE },
    { label: "Suspended", value: overview.tenants.SUSPENDED },
    { label: "Rejected", value: overview.tenants.REJECTED },
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
          <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="text-2xl font-semibold tabular-nums">{card.value}</div>
            <div className="mt-1 text-xs text-slate-400">{card.label}</div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-slate-400">
        Clinic registration approvals arrive in Stage 3.
      </p>
    </div>
  );
}
