import PageHeader from "@/components/ui/PageHeader";
import Skeleton, { SkeletonText } from "@/components/ui/Skeleton";

export default function PhoneMenuLoading() {
  return (
    <section className="space-y-4" aria-busy="true" aria-label="Loading phone menu">
      <PageHeader
        title="Phone menu"
        description="Loading this clinic's automated menu."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.75fr)]">
        <div className="space-y-5">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-line bg-canvas p-5 shadow-card"
            >
              <Skeleton className="h-5 w-36" />
              <SkeletonText lines={item === 3 ? 5 : 2} className="mt-5" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-line bg-canvas p-5 shadow-card">
          <Skeleton className="h-5 w-28" />
          <SkeletonText lines={7} className="mt-5" />
        </div>
      </div>
    </section>
  );
}
