import Skeleton, { SkeletonText } from "@/components/ui/Skeleton";

function PanelSkeleton({ className = "", rows = 4 }: { className?: string; rows?: number }) {
  return (
    <div className={`rounded-2xl border border-line bg-canvas p-4 shadow-card sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div><Skeleton className="w-36" /><Skeleton className="mt-2 h-3 w-52 max-w-full" /></div>
        <Skeleton className="h-3 w-20" />
      </div>
      <SkeletonText className="mt-6" lines={rows} />
    </div>
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-4 sm:space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row">
        <div className="space-y-2">
          <Skeleton className="h-7 w-60 max-w-full" />
          <Skeleton className="h-3.5 w-96 max-w-full" />
          <Skeleton className="h-3 w-44" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Skeleton className="col-span-2 h-9 w-full sm:w-32" />
          <Skeleton className="h-9 w-full sm:w-24" />
          <Skeleton className="h-9 w-full sm:w-24" />
          <Skeleton className="col-span-2 h-9 w-full sm:w-28" />
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-canvas p-4 shadow-card sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Skeleton className="w-28" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas-deep p-1">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-[82px] w-full rounded-xl" />
          <Skeleton className="h-[82px] w-full rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className={`min-h-[116px] rounded-2xl border border-line bg-canvas p-4 shadow-card ${index === 6 ? "xl:col-span-2" : ""}`}>
            <div className="flex justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-9 w-9" /></div>
            <Skeleton className="mt-3 h-7 w-24" /><Skeleton className="mt-2.5 h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PanelSkeleton rows={8} /><PanelSkeleton rows={8} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <PanelSkeleton className="xl:col-span-2" rows={7} /><PanelSkeleton rows={6} />
      </div>

      <PanelSkeleton rows={4} />
      <div className="grid gap-4 xl:grid-cols-5">
        <PanelSkeleton className="xl:col-span-3" rows={5} /><PanelSkeleton className="xl:col-span-2" rows={5} />
      </div>
      <PanelSkeleton rows={5} />
      <div className="grid gap-4 xl:grid-cols-2">
        <PanelSkeleton rows={4} /><PanelSkeleton rows={4} />
      </div>
    </div>
  );
}
