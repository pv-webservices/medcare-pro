import Skeleton, { TableSkeleton } from "@/components/ui/Skeleton";

/**
 * What appointments looks like while it loads.
 *
 * THE SHAPE OF THE SCREEN THAT IS COMING, not a spinner. The row count and the
 * column count are approximate on purpose — close enough that the real content
 * lands without the page jumping, not so exact that this file has to be updated
 * every time a column moves.
 *
 * The region is `aria-busy`, and the placeholders inside it are hidden from
 * assistive technology, so a screen reader hears "loading" once instead of
 * reading out forty empty boxes.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      {/* 1. Page Header Skeleton */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="skeleton block h-8 w-44 rounded-xl" />
            <span aria-hidden="true" className="skeleton block h-6 w-24 rounded-full" />
          </div>
          <span aria-hidden="true" className="skeleton block h-4 w-72 max-w-full rounded" />
          <span aria-hidden="true" className="skeleton block h-3.5 w-64 max-w-full rounded" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span aria-hidden="true" className="skeleton block h-11 w-24 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-11 w-44 rounded-xl" />
        </div>
      </div>

      {/* 2. Date / View Toolbar Skeleton */}
      <div className="flex flex-col gap-3 rounded-3xl border border-line bg-canvas p-3 shadow-card sm:flex-row sm:items-center sm:justify-between lg:p-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="skeleton block h-9 w-9 rounded-xl" />
          <div className="space-y-1.5">
            <span aria-hidden="true" className="skeleton block h-4 w-36 rounded" />
            <span aria-hidden="true" className="skeleton block h-3 w-16 rounded" />
          </div>
        </div>
        <span aria-hidden="true" className="skeleton block h-10 w-44 rounded-2xl" />
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="skeleton block h-9 w-16 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-9 w-32 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-9 w-20 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-9 w-9 rounded-xl" />
        </div>
      </div>

      {/* 3. Filter Surface Skeleton */}
      <div className="hidden rounded-3xl border border-line bg-canvas p-4 shadow-card md:flex md:items-end md:justify-between md:gap-4 md:p-5">
        <div className="flex items-end gap-3">
          <span aria-hidden="true" className="skeleton block h-11 w-56 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-11 w-48 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-6 w-60 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="skeleton block h-9 w-16 rounded-xl" />
          <span aria-hidden="true" className="skeleton block h-9 w-20 rounded-xl" />
        </div>
      </div>

      {/* 4. Schedule Surface & Table Skeleton */}
      <div className="overflow-hidden rounded-3xl border border-line bg-canvas shadow-card">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <span aria-hidden="true" className="skeleton block h-5 w-40 rounded" />
          <span aria-hidden="true" className="skeleton mt-1.5 block h-3.5 w-64 rounded" />
        </div>
        <div className="flex gap-4 border-b border-line bg-canvas-deep px-5 py-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <span key={index} className="skeleton h-3 flex-1 rounded" aria-hidden="true" />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, row) => (
          <div
            key={row}
            className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-b-0"
          >
            {Array.from({ length: 8 }).map((_, column) => (
              <span
                key={column}
                aria-hidden="true"
                className="skeleton h-4 flex-1 rounded"
              />
            ))}
          </div>
        ))}
      </div>

      {/* 5. Pagination Skeleton */}
      <div className="mt-4 flex items-center justify-between">
        <span aria-hidden="true" className="skeleton block h-4 w-48 rounded" />
        <span aria-hidden="true" className="skeleton block h-9 w-44 rounded-xl" />
      </div>
    </div>
  );
}
