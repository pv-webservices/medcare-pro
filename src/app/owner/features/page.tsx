import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireOwnerPage } from "@/lib/platform/ownerPage";
import { getPlatformFeatureAdmin } from "@/lib/platform/entitlements";
import GlobalFeatureSwitches from "@/components/owner/GlobalFeatureSwitches";

/**
 * The platform-wide feature switches — Stage 9, layer 1.
 *
 * Rendered on the server, including the affected-organisation counts: those are
 * computed across every tenant on the platform, so shipping the raw rows to a
 * client component to count would put the whole customer census into a browser
 * to render nine numbers.
 *
 * The page renders the switches but does not authorize them. The panel posts to
 * /api/owner/features, which runs requirePlatformOwner() and the whole switch
 * policy again server-side. Rendering a button is not permission to press it.
 */
export default async function OwnerFeaturesPage() {
  const owner = await requireOwnerPage();
  const { features, totalCustomerTenants } = await getPlatformFeatureAdmin(owner);

  const live = features.filter((feature) => feature.globalEnabled).length;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link
        href="/owner/dashboard"
        className="mb-6 inline-flex items-center gap-2 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Platform overview
      </Link>

      <h1 className="text-xl font-semibold">Platform features</h1>
      <p className="mt-1 max-w-2xl text-xs text-muted">
        The first of four layers. A feature switched off here is off for every
        organisation on MEDCARE PRO, whatever their plan says and whatever their
        own admin has set — no plan, override or role can reach past it.{""}
        <span className="tabular-nums text-muted">{live}</span> of{""}
        <span className="tabular-nums text-muted">{features.length}</span>{""}
        live.
      </p>

      <div className="mt-6">
        <GlobalFeatureSwitches
          features={features}
          totalCustomerTenants={totalCustomerTenants}
        />
      </div>

      <p className="mt-8 text-[11px] text-faint">
        Adding a feature to this list is a code change, not a screen: a key
        nothing checks gates nothing. See src/lib/defaultFeatures.ts.
      </p>
    </div>
  );
}
