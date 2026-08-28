"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface AdminDashboardDatePickerProps {
  current: string;
  today: string;
}

/** A single operational day. Today is represented by the clean /dashboard URL. */
export default function AdminDashboardDatePicker({
  current,
  today,
}: AdminDashboardDatePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const choose = useCallback(
    (date: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("range");

      if (date === today) {
        params.delete("date");
      } else {
        params.set("date", date);
      }

      const query = params.toString();
      router.push(query ? `/dashboard?${query}` : "/dashboard", {
        scroll: false,
      });
    },
    [router, searchParams, today],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="admin-dashboard-date">
        Dashboard date
      </label>
      <input
        id="admin-dashboard-date"
        type="date"
        value={current}
        onChange={(event) => choose(event.target.value || today)}
        className="h-9 rounded-full border border-line bg-canvas-deep px-3 text-meta font-medium text-muted transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {current !== today && (
        <button
          type="button"
          onClick={() => choose(today)}
          className="h-9 rounded-full border border-line bg-canvas px-3 text-meta font-medium text-accent transition-colors duration-150 hover:border-line-strong hover:text-accent-strong"
        >
          Today
        </button>
      )}
    </div>
  );
}
