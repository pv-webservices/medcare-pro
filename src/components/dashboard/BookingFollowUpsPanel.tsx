"use client";

import { CheckCircle2, LoaderCircle, PhoneCall } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClasses, cx, useToast } from "@/components/ui";
import type {
  DashboardBookingFollowUp,
  DashboardBookingFollowUpsModel,
} from "@/lib/telephony/bookingFollowUps";
import type { ApiResponse } from "@/lib/utils";

function relativeTime(value: string, now: Date): string {
  const occurredAt = new Date(value);
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - occurredAt.getTime()) / 60_000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function BookingFollowUpsPanel({
  model,
  now,
}: {
  model: DashboardBookingFollowUpsModel | null;
  now: Date;
}) {
  const router = useRouter();
  const showToast = useToast();
  const [items, setItems] = useState<readonly DashboardBookingFollowUp[]>(
    model?.items ?? [],
  );
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function markResolved(item: DashboardBookingFollowUp) {
    if (resolvingId !== null) return;
    setResolvingId(item.id);
    try {
      const response = await fetch(
        `/api/clinics/${encodeURIComponent(item.clinicId)}/telephony/booking-follow-ups/${encodeURIComponent(item.id)}/resolve`,
        { method: "POST" },
      );
      const payload = (await response.json()) as ApiResponse<{
        id: string;
        status: string;
      }>;
      if (
        !response.ok ||
        !payload.success ||
        payload.data?.id !== item.id ||
        payload.data.status !== "RESOLVED"
      ) {
        throw new Error("The resolved status was not confirmed.");
      }
      setItems((current) => current.filter((row) => row.id !== item.id));
      showToast({ tone: "ok", title: "Booking follow-up marked resolved." });
      router.refresh();
    } catch {
      showToast({
        tone: "alert",
        title: "Booking follow-up wasn't changed. Try again.",
      });
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <section
      aria-labelledby="booking-follow-ups-title"
      className="overflow-hidden rounded-2xl border border-warn-ink/25 bg-warn-bg shadow-card"
    >
      <div className="border-b border-warn-ink/15 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-canvas text-warn-ink">
            <PhoneCall aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <h2
              id="booking-follow-ups-title"
              className="text-section font-semibold text-ink"
            >
              Booking follow-ups
            </h2>
            <p className="text-meta text-muted">
              Pending IVR requests that need staff action
            </p>
          </div>
        </div>
      </div>

      <ol className="divide-y divide-warn-ink/15">
        {items.map((item) => {
          const busy = resolvingId === item.id;
          return (
            <li
              key={item.id}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
            >
              <div className="min-w-0">
                <p className="text-body font-bold text-ink">
                  {item.callerNumber ?? "Caller number unavailable"}
                </p>
                <p className="mt-0.5 text-label font-medium text-warn-ink">
                  {item.reasonLabel}
                </p>
                <p className="mt-1 text-meta text-muted">
                  {item.clinicName} · {relativeTime(item.createdAt, now)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {item.callerNumber && (
                  <a
                    href={`tel:${item.callerNumber}`}
                    className={buttonClasses("secondary", "sm")}
                  >
                    <PhoneCall aria-hidden="true" className="h-4 w-4" />
                    Call
                  </a>
                )}
                <button
                  type="button"
                  disabled={resolvingId !== null}
                  onClick={() => void markResolved(item)}
                  className={cx(
                    buttonClasses("primary", "sm"),
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {busy ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                  ) : (
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                  )}
                  {busy ? "Resolving..." : "Mark resolved"}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
