"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/ui";

export default function AdminDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Operational dashboard failed to render", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  function retry() {
    router.refresh();
    reset();
  }

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center rounded-3xl border border-line bg-canvas p-8 text-center shadow-card">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl border border-alert-line bg-alert-bg text-alert-ink"
      >
        <AlertTriangle className="h-7 w-7" strokeWidth={2} />
      </span>
      <h1 className="mt-5 text-title font-semibold text-ink">
        Unable to load today&apos;s dashboard
      </h1>
      <p className="mt-2 text-body leading-relaxed text-muted">
        The operational data could not be loaded. No placeholder values are
        being shown; try again when the connection is available.
      </p>
      <button
        type="button"
        onClick={retry}
        className={buttonClasses("primary", "md", "mt-6")}
      >
        <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
        Try again
      </button>
    </section>
  );
}
