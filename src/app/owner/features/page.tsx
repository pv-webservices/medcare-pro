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
          Platform features
        </h1>
        <p className="mt-1.5 max-w-3xl text-xs sm:text-sm text-slate-400 leading-relaxed">
          Control platform-wide features for all organisations on MEDCARE PRO.
          <br className="hidden sm:inline" /> Switch features on or off for every organisation, regardless of plan or role.
        </p>
      </div>

      <GlobalFeatureSwitches
        features={features}
        totalCustomerTenants={totalCustomerTenants}
      />

      <p className="mt-8 text-[11px] text-slate-500">
        Adding a feature to this list is a code change, not a screen: a key
        nothing checks gates nothing. See{" "}
        <code className="rounded border border-slate-800 bg-slate-900/80 px-1.5 py-0.5 text-slate-400">
          src/lib/defaultFeatures.ts
        </code>
        .
      </p>
    </div>
  );
}
