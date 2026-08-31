"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import DatePicker from "@/components/ui/DatePicker";

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
      <div className="w-40 sm:w-44">
        <DatePicker
          id="admin-dashboard-date"
          label="Dashboard date"
          isLabelHidden
          value={current}
          onChange={(newDate) => choose(newDate || today)}
          className="!min-h-9 !py-1 !rounded-full !text-meta bg-canvas-deep"
          showClear={false}
          showToday={false}
        />
      </div>
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
