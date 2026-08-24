"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { buttonClasses } from "@/components/ui";

/**
 * Error boundary for every page in the signed-in shell.
 *
 * THE BUG THIS FIXES, because it is not visible from the code it replaces.
 * There was no error boundary anywhere in this app. In the App Router that has
 * a specific and badly misleading consequence: when a Server Component throws
 * during a CLIENT-SIDE navigation, the router has nowhere to put the error, so
 * it abandons the navigation. The URL may or may not change, the current page
 * stays on screen, and nothing is reported. Clicking a tab simply does nothing.
 *
 * That is exactly how a database outage presented — every tab dead, the
 * already-rendered Dashboard still on screen, and the whole thing reported as
 * "only the Dashboard tab works". The cause was never navigation or
 * permissions; it was an unhandled throw with no boundary to catch it.
 *
 * BECAUSE THIS FILE SITS INSIDE THE ROUTE GROUP, the layout above it still
 * renders: the sidebar, the clinic switcher and every nav link survive the
 * error. A failed page can no longer trap anyone on the page they came from —
 * the way out is always on screen. That is the property worth protecting here,
 * more than the wording below.
 *
 * `reset()` re-renders the segment without a full page load, which is the right
 * recovery for a transient fault (a dropped database connection, a timeout).
 * The Dashboard link is the escape hatch for a fault that is not transient.
 */

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  const router = useRouter();

  /**
   * BOTH CALLS ARE REQUIRED, and the order matters.
   *
   * `reset()` on its own only re-renders the boundary's children from the
   * router cache — which still holds the failed result, so the same error is
   * thrown again immediately and the button appears to do nothing. This was
   * verified against a real database outage: with `reset()` alone, "Try again"
   * never recovered even once the database was back.
   *
   * `router.refresh()` is what discards the cached payload and refetches the
   * segment from the server. It is called first so the fresh data is in flight
   * before `reset()` re-renders against it.
   */
  function handleRetry() {
    router.refresh();
    reset();
  }

  useEffect(() => {
    // The server has already logged the throw with its stack; this is the
    // client half, so a report from a user includes the digest that ties the
    // two together. `digest` is the only identifier that survives to production
    // — the message and stack are deliberately stripped there.
    console.error("Dashboard page failed to render", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col items-center rounded-4xl bg-canvas p-8 text-center shadow-neu-raised">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-3xl bg-canvas text-alert-ink shadow-neu-inset"
      >
        <AlertTriangle strokeWidth={2} className="h-7 w-7" />
      </span>

      <h1 className="mt-5 text-title font-extrabold text-ink">
        This screen didn&apos;t load
      </h1>

      <p className="mt-2 text-body font-medium leading-relaxed text-muted">
        Something failed while building this page. Your work is safe, and the
        rest of the app still works — use the menu to move somewhere else, or
        try again.
      </p>

      {error.digest && (
        <p className="mt-4 rounded-2xl bg-canvas px-4 py-2 text-meta font-medium text-faint shadow-neu-inset">
          Reference: <span className="tnum font-bold">{error.digest}</span>
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleRetry}
          className={buttonClasses("commit", "md")}
        >
          <RefreshCw aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
          Try again
        </button>

        <Link href="/dashboard" className={buttonClasses("secondary", "md")}>
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
