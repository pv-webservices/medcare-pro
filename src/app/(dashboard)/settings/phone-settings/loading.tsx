import PageHeader from "@/components/ui/PageHeader";
import Skeleton, { SkeletonText } from "@/components/ui/Skeleton";

export default function PhoneSettingsLoading() {
  return (
    <section
      className="space-y-5"
      aria-busy="true"
      aria-label="Loading phone settings"
    >
      <PageHeader
        title="Phone settings"
        description="Loading this clinic's phone operations."
      />
      <div className="rounded-3xl border border-line bg-canvas p-5 shadow-card">
        <Skeleton className="h-5 w-44" />
        <SkeletonText lines={3} className="mt-5" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[1, 2].map((item) => (
          <div
            key={item}
            className="rounded-3xl border border-line bg-canvas p-5 shadow-card"
          >
            <Skeleton className="h-5 w-36" />
            <SkeletonText lines={7} className="mt-5" />
          </div>
        ))}
      </div>
    </section>
  );
}

