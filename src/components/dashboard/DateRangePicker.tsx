"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import {
  DASHBOARD_PRESETS,
  PRESET_LABELS,
  type DashboardPreset,
} from "@/lib/dashboardDateRange";

interface DateRangePickerProps {
  current: DashboardPreset;
}

export default function DateRangePicker({ current }: DateRangePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      const params = new URLSearchParams(searchParams.toString());

      if (value === "thisMonth") {
        params.delete("range");
      } else {
        params.set("range", value);
      }

      const qs = params.toString();
      router.push(qs ? `?${qs}` : "/dashboard", { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <select
      value={current}
      onChange={handleChange}
      aria-label="Date range"
      className="h-9 w-full cursor-pointer rounded-xl border border-line bg-canvas px-3 text-meta font-medium text-muted shadow-card transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:w-auto"
    >
      {DASHBOARD_PRESETS.map((preset) => (
        <option key={preset} value={preset}>
          {PRESET_LABELS[preset]}
        </option>
      ))}
    </select>
  );
}
