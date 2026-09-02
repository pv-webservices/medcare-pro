import Link from "next/link";
import { Plus } from "lucide-react";
import { cx } from "@/components/ui/cx";

export default function BrandMark({
  className,
  isCompact = false,
}: {
  className?: string;
  isCompact?: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-3 w-full", className)}>
      <Link
        href="/dashboard"
        className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-90"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-600/30"
        >
          <Plus strokeWidth={2.5} className="h-5 w-5" />
        </span>
        <span className={cx("min-w-0", isCompact && "hidden")}>
          <span className="block truncate text-base font-bold tracking-tight text-white">
            MedCare Pro
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Clinic operations
          </span>
        </span>
      </Link>
    </div>
  );
}

