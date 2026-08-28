import Skeleton, { MetricSkeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <span aria-hidden="true" className="skeleton block h-7 w-52" />
        <span aria-hidden="true" className="skeleton block h-3.5 w-80 max-w-full" />
      </div>

      {/* KPIs */}
      <MetricSkeleton />

      {/* Trend + today */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card xl:col-span-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-5 h-56 w-full" />
        </div>
        <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
          <Skeleton className="h-3 w-20" />
          <SkeletonText className="mt-5" lines={4} />
        </div>
      </div>

      {/* Clinic performance */}
      <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
        <Skeleton className="h-3 w-44" />
        <SkeletonText className="mt-5" lines={4} />
      </div>

      {/* Doctor performance */}
      <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
        <Skeleton className="h-3 w-32" />
        <SkeletonText className="mt-5" lines={4} />
      </div>

      {/* Activity + attention */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card xl:col-span-2">
          <Skeleton className="h-3 w-36" />
          <SkeletonText className="mt-5" lines={5} />
        </div>
        <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
          <Skeleton className="h-3 w-40" />
          <SkeletonText className="mt-5" lines={3} />
        </div>
      </div>
    </div>
  );
}
