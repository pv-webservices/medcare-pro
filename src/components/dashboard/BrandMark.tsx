import Link from "next/link";
import { Plus } from "lucide-react";
import { cx } from "@/components/ui/cx";

/**
 * The MedCare Pro lockup in the signed-in shell.
 *
 * THE PLATFORM'S BRAND, NOT THE TENANT'S. A clinic's own logo and colour appear
 * where that clinic's data appears — the clinic switcher, the row rails, the
 * branding preview — and never here. Someone covering two clinics needs one
 * fixed point on the screen that does not change when they switch scope, and
 * this is it.
 *
 * It links to /dashboard: a wordmark in the top-left corner of a web
 * application is expected to go home, and a user who has followed three
 * detail pages deep looks for it before they look for the nav.
 */
export default function BrandMark({
  className,
  isCompact = false,
}: {
  className?: string;
  isCompact?: boolean;
}) {
  return (
    <Link
      href="/dashboard"
      className={cx("flex min-w-0 items-center gap-2.5 rounded-xl", className)}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-cta"
      >
        <Plus strokeWidth={3} className="h-[18px] w-[18px]" />
      </span>
      <span className={cx("min-w-0", isCompact && "hidden")}>
        <span className="block truncate text-section font-semibold leading-none tracking-[-0.01em] text-ink">
          MedCare Pro
        </span>
        <span className="mt-1 block truncate text-micro font-semibold uppercase text-faint">
          Clinic operations
        </span>
      </span>
    </Link>
  );
}
