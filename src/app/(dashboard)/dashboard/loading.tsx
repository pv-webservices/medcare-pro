import Skeleton, { MetricSkeleton, SkeletonText } from "@/components/ui/Skeleton";

/**
 * What dashboard looks like while it loads.
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
      <div className="space-y-2">
        <span aria-hidden="true" className="skeleton block h-7 w-52" />
        <span aria-hidden="true" className="skeleton block h-3.5 w-80 max-w-full" />
      </div>
      <MetricSkeleton />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card xl:col-span-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-5 h-52 w-full" />
        </div>
        <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
          <Skeleton className="h-3 w-32" />
          <SkeletonText className="mt-5" lines={6} />
        </div>
      </div>
    </div>
  );
}
