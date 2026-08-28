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
      className="cursor-pointer rounded-full border border-line bg-canvas-deep px-3 py-1.5 text-meta font-medium text-muted transition-colors duration-150 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {DASHBOARD_PRESETS.map((preset) => (
        <option key={preset} value={preset}>
          {PRESET_LABELS[preset]}
        </option>
      ))}
    </select>
  );
}
