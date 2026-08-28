import Link from "next/link";
import { Lock } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import {
  describeFeatureDenial,
  type ModuleDenialReason,
} from "@/lib/featureResolution";

/**
 * What a gated module shows to someone who cannot open it — Stage 8.
 *
 * The screen NAMES THE LAYER, because the three refusals send the reader to
 * three different people:
 *
 *   role        — an admin in their own organisation, two desks away;
 *   entitlement — whoever owns the account's commercial relationship;
 *   global      — nobody. It is ours, and there is nothing for them to do.
 *
 * A single generic sentence would leave a receptionist filing a ticket about
 * something their own admin could fix in ten seconds. The messages stop short of
 * anything internal: no plan key, no feature key, no mention of other tenants or
 * of why a platform switch is down.
 *
 * This renders INSTEAD of the page, having already been refused server-side. It
 * is not what enforces anything — see requireModule in lib/features.ts.
 */

interface ModuleLockedProps {
  /** The module's name in the PRD's vocabulary, e.g. "Revenue reports". */
  title: string;
  reason: ModuleDenialReason;
}

export default function ModuleLocked({ title, reason }: ModuleLockedProps) {
  return (
    <section>
      <PageHeader title={title} />

      <div className="rounded-3xl border border-line bg-canvas px-6 py-14 text-center shadow-card">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-canvas-deep"
        >
          <Lock strokeWidth={2} className="h-5 w-5 text-muted" />
        </div>

        <p className="text-section font-semibold text-ink">
          {title} is not available
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-body text-muted">
          {describeFeatureDenial(reason)}
        </p>

        {/*
          Only for the one refusal the reader's own organisation can undo. The
          link is offered to everybody: the Features screen does its own
          permission check, and someone who cannot open it learns who to ask by
          trying, which beats guessing.
        */}
        {reason === "role" && (
          <div className="mt-6 flex justify-center">
            <Link href="/settings/features" className={buttonClasses("secondary")}>
              Open feature settings
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
