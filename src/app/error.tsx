"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Root error boundary — the backstop for everything the segment boundaries
 * cannot catch.
 *
 * WHY THIS EXISTS SEPARATELY FROM (dashboard)/error.tsx. A boundary never
 * catches a throw from the layout it sits beside; that belongs to the boundary
 * ABOVE it. So an error inside src/app/(dashboard)/layout.tsx — which is where
 * `requireActor()` runs, and therefore where a database outage lands first —
 * sails straight past the dashboard boundary and arrives here.
 *
 * That is not a hypothetical ordering. With the database down, the shell threw
 * PrismaClientKnownRequestError from loadSessionContext() before any page was
 * reached, and with no boundary at this level the router silently abandoned
 * every navigation. This file is the reason that now renders something.
 *
 * It renders WITHOUT the app shell, because the shell is what failed. No links
 * into the app are offered for the same reason: sending someone to /dashboard
 * when the layout behind /dashboard is the thing throwing is how a redirect
 * loop gets built. Retry, or sign in again — both of which can succeed on their
 * own once the fault clears.
 */

interface RootErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error }: RootErrorProps) {
  /**
   * A FULL DOCUMENT RELOAD, not `reset()`.
   *
   * `reset()` re-renders from the router cache, which still holds the failed
   * payload — it recovers nothing on its own (see the note in
   * (dashboard)/error.tsx). The dashboard boundary pairs it with
   * `router.refresh()`, but that is not the right answer here: what failed at
   * this level is the app shell, so the client router is itself part of the
   * suspect state. Reloading the document rebuilds everything from scratch and
   * cannot be defeated by a stale cache.
   *
   * `reset` stays in the props type because Next passes it, but it is
   * deliberately not destructured — nothing here should reach for it.
   */
  function handleRetry() {
    window.location.reload();
  }

  useEffect(() => {
    console.error("Application shell failed to render", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <section className="flex w-full max-w-xl flex-col items-center rounded-4xl bg-canvas p-8 text-center shadow-neu-raised">
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-3xl bg-canvas text-alert-ink shadow-neu-inset"
        >
          <AlertTriangle strokeWidth={2} className="h-7 w-7" />
        </span>

        <h1 className="mt-5 text-title font-extrabold text-ink">
          MedCare Pro is temporarily unavailable
        </h1>

        <p className="mt-2 text-body font-medium leading-relaxed text-muted">
          We couldn&apos;t load the application. This is usually a brief service
          interruption rather than a problem with your account — no data has been
          lost. Try again in a moment.
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
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-body font-semibold text-accent-ink shadow-neu-raised-sm transition-colors duration-200 hover:bg-primary-hover"
          >
            <RefreshCw aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
            Try again
          </button>

          {/*
            A full document load, not a <Link>. The client router is part of what
            may be wedged here, so recovery must not depend on it.
          */}
          <a
            href="/login"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-canvas px-5 text-body font-semibold text-ink shadow-neu-raised-sm transition-shadow duration-200 hover:shadow-neu-raised"
          >
            Sign in again
          </a>
        </div>
      </section>
    </main>
  );
}
