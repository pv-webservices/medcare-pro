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
    <div className="mx-auto max-w-4xl p-8">
      <Link
        href="/owner/dashboard"
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Platform overview
      </Link>

      <h1 className="text-xl font-semibold">Plans</h1>
      <p className="mt-1 max-w-2xl text-xs text-muted">
        The second layer. A plan is the baseline every organisation on it
        follows, and a change here reaches them the moment it saves — except
        where an organisation carries an override of its own, which the plan does
        not decide. To change one organisation, open it from Clinic applications
        instead.
      </p>

      <div className="mt-6">
        <PlanFeatureEditor plans={plans} />
      </div>

      <p className="mt-8 text-[11px] text-faint">
        Creating and retiring plans is not on this screen. A plan is a commercial
        object with tenants pointing at it under a Restrict foreign key, and
        deleting one out from under them would strip every feature they are
        paying for — retire it by clearing <code>isActive</code> instead.
      </p>
    </div>
  );
}
