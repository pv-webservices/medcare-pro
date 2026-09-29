import { TriangleAlert } from "lucide-react";
import type { MissingCatalogueFeature } from "@/lib/featureInstallation";

/**
 * Settings → Features: catalogue features this version ships but this database
 * has not installed. Display only; the modules stay closed until an
 * administrator runs the named command.
 */
export default function MissingFeaturesBanner({ missing }: { missing: readonly MissingCatalogueFeature[] }) {
  if (missing.length === 0) return null;
  return (
    <div role="status" aria-labelledby="missing-features-title"
      className="space-y-2 rounded-2xl border border-warn-line bg-warn-bg px-5 py-4 text-warn-ink">
      <p id="missing-features-title" className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
        {missing.length === 1 ? "A module is not installed on this database" : `${missing.length} modules are not installed on this database`}
      </p>
      <ul className="space-y-1 text-body">
        {missing.map((feature) => <li key={feature.key}>{feature.message}</li>)}
      </ul>
    </div>
  );
}
