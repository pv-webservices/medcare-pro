import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getPlanAdmin } from "@/lib/platform/entitlements";
import PlanFeatureEditor from "@/components/owner/PlanFeatureEditor";

/**
 * What each plan includes — Stage 9, layer 2a.
 *
 * A plan edit is retroactive by design: PlanFeature is read live on every
 * request, so adding a feature grants it immediately to every organisation on
 * the plan that has no override, and removing one takes it away just as fast.
 * That is what a plan IS — the alternative, snapshotting entitlements per tenant
 * at signup, would mean no plan change ever reached an existing customer.
 *
 * The count of organisations on each plan is rendered next to its name for
 * exactly that reason.
 */
export default async function OwnerPlansPage() {
  const owner = await requireOwnerPage();
  const plans = await getPlanAdmin(owner);

  return (
    <div className="w-full px-4 py-7 sm:px-6 md:px-8 lg:px-10 space-y-6 text-white font-sans">
      {/* Breadcrumbs & Header */}
      <div>
        <Link
          href="/owner/dashboard"
          className="group inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Platform overview</span>
        </Link>

        <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white">
          Plans
        </h1>
        <p className="mt-1.5 max-w-4xl text-xs sm:text-sm text-slate-400 leading-relaxed">
          The second layer. A plan is the baseline every organisation on it
          follows, and a change here reaches them the moment it saves &mdash; except
          where an organisation carries an override of its own, which the plan does
          not decide. To change one organisation, open it from Clinic applications
          instead.
        </p>
      </div>

      <PlanFeatureEditor plans={plans} />

      <p className="mt-8 text-[11px] text-slate-500">
        Creating and retiring plans is not on this screen. A plan is a commercial
        object with tenants pointing at it under a Restrict foreign key, and
        deleting one out from under them would strip every feature they are
        paying for &mdash; retire it by clearing <code className="text-slate-400 bg-slate-900/80 px-1 py-0.5 rounded border border-slate-800">isActive</code> instead.
      </p>
    </div>
  );
}
