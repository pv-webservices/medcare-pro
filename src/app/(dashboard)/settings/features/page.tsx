import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import FeatureMatrix from "@/components/settings/FeatureMatrix";
import PageHeader from "@/components/ui/PageHeader";
import { getFeatureOverview, type FeatureOverview } from "@/lib/features";
import { PermissionError } from "@/lib/rbac";
import { requireActor, UnauthenticatedError } from "@/lib/session";

// Feature access — Stage 8, the tenant side of the four-layer model.
//
// `feature:view` gates the page and `feature:manage` gates every control on it,
// both enforced in @/lib/features rather than by hiding anything: reaching this
// URL directly gets the same refusal the API gives.
//
// THIS PAGE IS NEVER FEATURE-GATED, unlike every other module. It is the screen
// that undoes a feature switch, so putting it behind one would let an
// organisation close the only door back — see UNGATED_MODULES in
// @/lib/features. The same reasoning keeps /settings/roles ungated.
//
// Layers 1 and 2 are read-only here. What the organisation is entitled to is
// the Platform Owner's decision, made on /owner/features and /owner/plans
// (Stage 9); what each role does with that entitlement is this screen's.

export default async function FeatureSettingsPage() {
  let actor;
  try {
    actor = await requireActor();
  } catch (error: unknown) {
    if (error instanceof UnauthenticatedError) {
      redirect("/login");
    }
    throw error;
  }

  let overview: FeatureOverview | null = null;
  try {
    overview = await getFeatureOverview(actor);
  } catch (error: unknown) {
    if (!(error instanceof PermissionError)) {
      throw error;
    }
  }

  if (!overview) {
    return (
      <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-label font-medium text-slate-500 transition hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        Settings
      </Link>
        <PageHeader title="Features" />
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-500">
          Your role cannot view feature access. Ask the account owner if you need
          access.
        </div>
      </section>
    );
  }

  const included = overview.features.filter((feature) => feature.isEntitled).length;

  return (
    <section className="max-w-[1400px] mx-auto w-full animate-in fade-in duration-500 space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-label font-medium text-slate-500 transition hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
        Settings
      </Link>
      <PageHeader
        title="Features"
        meta={
          overview.canManage
            ? `${overview.planName ?? "No plan"} · ${included} of ${overview.features.length} features included. Choose which roles may use each one.`
            : `${overview.planName ?? "No plan"} · ${included} of ${overview.features.length} features included.`
        }
      />

      <FeatureMatrix features={overview.features} canManage={overview.canManage} />
    </section>
  );
}
