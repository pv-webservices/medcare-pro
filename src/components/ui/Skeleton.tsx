import { cx } from "@/components/ui/cx";

/**
 * Loading placeholders.
 *
 * A LOADING SCREEN SHOULD HAVE THE SHAPE OF THE SCREEN THAT IS COMING. A
 * spinner in the middle of a white page tells the reader only that something is
 * happening; a skeleton tells them what is arriving and stops the layout
 * jumping when it does. Match the real thing's row count and column widths —
 * roughly, not exactly.
 *
 * Every placeholder is `aria-hidden` and the region that owns it carries
 * `aria-busy`, so a screen reader is told "loading" once rather than reading out
 * fourteen empty boxes.
 */

interface SkeletonProps {
  /** Tailwind width class, e.g. "w-24" or "w-full". */
  className?: string;
}

export default function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx("skeleton block h-4", className)} />;
}

/** A paragraph of placeholder lines, the last one short like real text. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cx("block space-y-2", className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className={cx(
            "skeleton block h-3.5",
            index === lines - 1 ? "w-2/5" : "w-full",
          )}
        />
      ))}
    </span>
  );
}

/** The shell of a table, for a list that has not arrived yet. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="overflow-hidden rounded-3xl border border-line bg-canvas shadow-card"
    >
      <div className="flex gap-4 border-b border-line bg-canvas-deep px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => (
          <span key={index} className="skeleton h-3 flex-1" aria-hidden="true" />
        ))}
      </div>

      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-b-0"
        >
          {Array.from({ length: columns }).map((_, column) => (
            <span
              key={column}
              aria-hidden="true"
              className={cx(
                "skeleton h-3.5",
                column === 0 ? "w-1/5 shrink-0" : "flex-1",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A grid of KPI placeholders, for the top of a dashboard or report. */
export function MetricSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-3xl border border-line bg-canvas p-5 shadow-card"
        >
          <span aria-hidden="true" className="skeleton block h-3 w-24" />
          <span aria-hidden="true" className="skeleton mt-4 block h-7 w-32" />
          <span aria-hidden="true" className="skeleton mt-3 block h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
